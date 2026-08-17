-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: private_wire_sizing
-- PV Sizing analysis records linked to private wire leads.
-- Run this in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS private_wire_sizing (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id                   UUID NOT NULL REFERENCES private_wire_leads(id) ON DELETE CASCADE,

  -- ── HH data summary ───────────────────────────────────────────────────────
  hh_filename               TEXT,
  hh_year                   INTEGER,
  mpan_list                 JSONB    DEFAULT '[]',
  annual_demand_mwh         NUMERIC(10,2),
  monthly_demand_mwh        JSONB,              -- float[12]
  monthly_avg_daily_profile JSONB,              -- float[12][48]  averaged kWh per HH slot
  peak_demand_kw            NUMERIC(10,2),
  load_factor               NUMERIC(6,4),

  -- ── PVGIS / solar resource ────────────────────────────────────────────────
  pvgis_lat                 NUMERIC(9,6),
  pvgis_lon                 NUMERIC(9,6),
  pvgis_annual_yield_kwh_kwp  NUMERIC(8,2),    -- raw kWh/kWp/year from PVGIS
  pvgis_monthly_kwh_kwp     JSONB,              -- float[12]  kWh/kWp per month
  availability_factor       NUMERIC(5,4)  DEFAULT 0.99,
  adjusted_yield_kwh_kwp    NUMERIC(8,2),       -- after availability

  -- ── Sizing ────────────────────────────────────────────────────────────────
  recommended_mwp           NUMERIC(6,2),
  selected_mwp              NUMERIC(6,2),

  -- ── Configuration ─────────────────────────────────────────────────────────
  has_export                BOOLEAN       DEFAULT FALSE,
  export_limit_mw           NUMERIC(8,3),
  ppa_price                 NUMERIC(8,2),       -- £/MWh
  ppa_term_years            INTEGER,
  cod                       DATE,
  operational_years         INTEGER       DEFAULT 40,
  degradation_pct           NUMERIC(6,4)  DEFAULT 0.004,

  -- ── Computed results (at selected_mwp) ───────────────────────────────────
  annual_generation_mwh     NUMERIC(10,2),
  annual_self_consumed_mwh  NUMERIC(10,2),
  annual_export_mwh         NUMERIC(10,2),
  annual_grid_import_mwh    NUMERIC(10,2),
  self_consumption_ratio    NUMERIC(6,4),
  demand_coverage_pct       NUMERIC(6,4),

  created_by                UUID,
  created_at                TIMESTAMPTZ   DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   DEFAULT NOW(),

  CONSTRAINT private_wire_sizing_lead_id_key UNIQUE (lead_id)
);

-- Auto-update updated_at on every edit
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_private_wire_sizing_updated_at ON private_wire_sizing;
CREATE TRIGGER update_private_wire_sizing_updated_at
  BEFORE UPDATE ON private_wire_sizing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS (match pattern used by other tables in the project)
ALTER TABLE private_wire_sizing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read sizing"
  ON private_wire_sizing FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert sizing"
  ON private_wire_sizing FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update sizing"
  ON private_wire_sizing FOR UPDATE TO authenticated USING (true);
