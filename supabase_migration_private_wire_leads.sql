-- ============================================================================
-- PRIVATE WIRE LEADS + ACTIVITY LOG
-- CRM tables for UK Private Wire top-of-funnel lead management
-- ============================================================================

-- ─── LEADS TABLE ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS private_wire_leads (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Monday.com reference (for migration traceability)
  monday_id       TEXT,                          -- Monday.com item ID
  monday_lead_id  TEXT,                          -- e.g. 'LEAD-05394'

  -- Organisation
  name            TEXT NOT NULL,                 -- Company name
  sector          TEXT NOT NULL,                 -- 'Cold Storage', 'Landfill', 'Building Materials / Quarries', etc.
  source          TEXT,                          -- 'LinkedIn Keyword', 'Conference', 'Cold Outreach', 'Referral', etc.
  location        TEXT,                          -- Site / HQ location

  -- Pipeline
  stage           TEXT NOT NULL DEFAULT 'New',   -- 'New','Contacted','Meeting Booked','Proposal','Negotiation','Won','Lost'
  interest_level  TEXT,                          -- 'Interested', 'Not Interested', 'TBC', etc.

  -- Owner
  owner           TEXT,                          -- Team member name or email

  -- Primary contact
  contact_name    TEXT,
  contact_role    TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  linkedin_person TEXT,                          -- LinkedIn profile URL for contact
  linkedin_company TEXT,                         -- LinkedIn company page URL

  -- Estimated load (captured later when lead → project)
  est_load_mw     NUMERIC(10,2),

  -- Archive / Not Interested
  archived        BOOLEAN DEFAULT FALSE,
  archive_reason  TEXT,
  archive_notes   TEXT,
  archived_at     TIMESTAMPTZ,

  -- Notes
  notes           TEXT,

  -- Monday.com URL (for back-reference)
  monday_url      TEXT,

  -- Metadata
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pw_leads_sector    ON private_wire_leads (sector);
CREATE INDEX IF NOT EXISTS idx_pw_leads_stage     ON private_wire_leads (stage);
CREATE INDEX IF NOT EXISTS idx_pw_leads_owner     ON private_wire_leads (owner);
CREATE INDEX IF NOT EXISTS idx_pw_leads_archived  ON private_wire_leads (archived);
CREATE INDEX IF NOT EXISTS idx_pw_leads_created   ON private_wire_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pw_leads_monday    ON private_wire_leads (monday_id);

-- Row Level Security
ALTER TABLE private_wire_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read leads"
  ON private_wire_leads FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert leads"
  ON private_wire_leads FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update leads"
  ON private_wire_leads FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete leads"
  ON private_wire_leads FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage leads"
  ON private_wire_leads FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── ACTIVITY LOG TABLE ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS private_wire_activity_log (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id         UUID NOT NULL REFERENCES private_wire_leads(id) ON DELETE CASCADE,

  -- Activity details
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  channel         TEXT NOT NULL,                 -- 'Email','LinkedIn','Call','WhatsApp','Meeting'
  direction       TEXT NOT NULL DEFAULT 'Outbound', -- 'Outbound','Inbound'
  notes           TEXT,
  response        BOOLEAN DEFAULT FALSE,         -- Did we get a response?

  -- Metadata
  logged_by       UUID,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pw_activity_lead   ON private_wire_activity_log (lead_id);
CREATE INDEX IF NOT EXISTS idx_pw_activity_date   ON private_wire_activity_log (date DESC);
CREATE INDEX IF NOT EXISTS idx_pw_activity_channel ON private_wire_activity_log (channel);

-- Row Level Security
ALTER TABLE private_wire_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read activity"
  ON private_wire_activity_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert activity"
  ON private_wire_activity_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update activity"
  ON private_wire_activity_log FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete activity"
  ON private_wire_activity_log FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage activity"
  ON private_wire_activity_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
