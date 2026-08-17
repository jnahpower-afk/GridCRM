-- Migrate private_wire_leads to person-centric model
-- Run in Supabase SQL Editor
--
-- What this does:
--   1. Adds contact_name / contact_email / contact_phone / contact_linkedin columns
--   2. Populates them from the first contact on each existing lead
--   3. For leads with 2+ contacts: creates a new lead row per additional contact,
--      copying all org-level fields (name, sector, owner, stage, etc.)
--
-- Safe to inspect before committing — wrapped in a transaction.

BEGIN;

-- ── Step 1: Add person-level columns ─────────────────────────────────────────
ALTER TABLE private_wire_leads
  ADD COLUMN IF NOT EXISTS contact_name     TEXT,
  ADD COLUMN IF NOT EXISTS contact_email    TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone    TEXT,
  ADD COLUMN IF NOT EXISTS contact_linkedin TEXT;

-- ── Step 2: Populate from each lead's FIRST contact ──────────────────────────
UPDATE private_wire_leads l
SET
  contact_name     = c.name,
  contact_email    = c.email,
  contact_phone    = c.phone,
  contact_linkedin = c.linkedin
FROM (
  SELECT DISTINCT ON (lead_id) lead_id, name, email, phone, linkedin
  FROM private_wire_contacts
  ORDER BY lead_id, created_at ASC
) c
WHERE c.lead_id = l.id
  AND l.contact_name IS NULL;

-- ── Step 3: Split multi-contact leads — one new row per extra contact ─────────
INSERT INTO private_wire_leads (
  name, sector, source, owner, country, location, notes, stage,
  last_contacted, created_at,
  contact_name, contact_email, contact_phone, contact_linkedin
)
SELECT
  l.name, l.sector, l.source, l.owner, l.country, l.location, l.notes, l.stage,
  l.last_contacted, NOW(),
  c.name, c.email, c.phone, c.linkedin
FROM private_wire_contacts c
JOIN private_wire_leads l ON l.id = c.lead_id
-- Exclude the first contact per lead (already the primary row)
WHERE c.id NOT IN (
  SELECT DISTINCT ON (lead_id) id
  FROM private_wire_contacts
  ORDER BY lead_id, created_at ASC
);

-- ── Verify results ────────────────────────────────────────────────────────────
SELECT
  COUNT(*)                                        AS total_leads,
  COUNT(contact_name)                             AS leads_with_contact_name,
  COUNT(*) - COUNT(contact_name)                  AS leads_missing_contact,
  COUNT(contact_email)                            AS leads_with_email
FROM private_wire_leads;

COMMIT;
