-- Consolidate private_wire_leads sectors → 10 canonical buckets
-- Run in Supabase SQL Editor
-- Safe to re-run (idempotent — uses IN lists covering all variants)

BEGIN;

-- 1. Food, Beverage & Cold Storage
UPDATE private_wire_leads SET sector = 'Food, Beverage & Cold Storage'
WHERE sector IN (
  'Food & Beverage', 'Cold Storage & Logistics', 'Cold Storage',
  'Agriculture & Feed', 'Logistics'
);

-- 2. Building Materials
UPDATE private_wire_leads SET sector = 'Building Materials'
WHERE sector IN (
  'Building Materials & Cement', 'Building Materials / Quarries',
  'Glass & Packaging', 'Glass', 'Cement', 'Brick & Ceramics',
  'Building Materials'
);

-- 3. Metals & Steel
UPDATE private_wire_leads SET sector = 'Metals & Steel'
WHERE sector IN (
  'Metals & Heavy Industry', 'Metals/Steel', 'Metals',
  'Metals & Steel'
);

-- 4. Chemicals
UPDATE private_wire_leads SET sector = 'Chemicals'
WHERE sector IN (
  'Chemicals & Plastics', 'Plastics', 'Chemicals'
);

-- 5. Pharmaceuticals
UPDATE private_wire_leads SET sector = 'Pharmaceuticals'
WHERE sector IN (
  'Pharmaceuticals & Life Sciences', 'Pharmaceuticals'
);

-- 6. Electronics & Data Centres
UPDATE private_wire_leads SET sector = 'Electronics & Data Centres'
WHERE sector IN (
  'Electronics & Data Centres', 'Data Centres', 'Electronics'
);

-- 7. Automotive
UPDATE private_wire_leads SET sector = 'Automotive'
WHERE sector IN (
  'Automotive & EV', 'Automotive'
);

-- 8. Aerospace & Defence
UPDATE private_wire_leads SET sector = 'Aerospace & Defence'
WHERE sector IN (
  'Aerospace & Defence', 'Aerospace'
);

-- 9. Water & Utilities
UPDATE private_wire_leads SET sector = 'Water & Utilities'
WHERE sector IN (
  'Water, Waste & Utilities', 'Water Treatment',
  'Waste Management', 'Water & Utilities'
);

-- 10. Other — catch-all for anything remaining
UPDATE private_wire_leads SET sector = 'Other'
WHERE sector NOT IN (
  'Food, Beverage & Cold Storage',
  'Building Materials',
  'Metals & Steel',
  'Chemicals',
  'Pharmaceuticals',
  'Electronics & Data Centres',
  'Automotive',
  'Aerospace & Defence',
  'Water & Utilities',
  'Other'
)
OR sector IS NULL
OR TRIM(sector) = '';

-- ── Verify results ────────────────────────────────────────────────────────────
SELECT sector, COUNT(*) AS leads
FROM private_wire_leads
GROUP BY sector
ORDER BY leads DESC;

COMMIT;
