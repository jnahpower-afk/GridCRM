-- ============================================================================
-- COMPARABLE TRANSACTIONS TABLE
-- Stores M&A comparable transaction data for benchmarking
-- ============================================================================

CREATE TABLE IF NOT EXISTS comparable_transactions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Deal identification
  project_name    TEXT NOT NULL,
  buyer           TEXT,
  seller          TEXT,
  advisor         TEXT,
  transaction_date DATE,

  -- Asset details
  technology      TEXT NOT NULL,               -- 'Solar', 'Wind', 'BESS', 'Gas Peaker', 'Hydrogen', 'Nuclear', 'Hydro'
  geography       TEXT,                        -- 'UK', 'Ireland', 'Spain', 'Germany', 'France', etc.
  capacity_mw     NUMERIC(10,2),              -- MW or MWp
  stage           TEXT,                        -- 'Development', 'RtB', 'Construction', 'Operational'

  -- Financial metrics
  price_per_mw    NUMERIC(12,2),              -- £/MW or €/MW
  total_value     NUMERIC(14,2),              -- Total transaction value
  currency        TEXT DEFAULT 'GBP',          -- 'GBP', 'EUR', 'USD'
  implied_irr     NUMERIC(5,2),               -- Implied project IRR %
  ev_to_mw        NUMERIC(12,2),              -- Enterprise value per MW

  -- Revenue context
  revenue_type    TEXT,                        -- 'CfD', 'PPA', 'Merchant', 'Mixed'

  -- Source & status
  source          TEXT,                        -- 'manual', 'news_suggested'
  source_url      TEXT,                        -- Link to news article or press release
  news_article_id UUID REFERENCES news_articles(id),  -- Link to auto-suggested article
  status          TEXT DEFAULT 'confirmed',    -- 'confirmed', 'suggested', 'rejected'
  notes           TEXT,

  -- Metadata
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_comps_tech       ON comparable_transactions (technology);
CREATE INDEX IF NOT EXISTS idx_comps_geo        ON comparable_transactions (geography);
CREATE INDEX IF NOT EXISTS idx_comps_stage      ON comparable_transactions (stage);
CREATE INDEX IF NOT EXISTS idx_comps_date       ON comparable_transactions (transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_comps_status     ON comparable_transactions (status);
CREATE INDEX IF NOT EXISTS idx_comps_created    ON comparable_transactions (created_at DESC);

-- Row Level Security
ALTER TABLE comparable_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read comps"
  ON comparable_transactions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert comps"
  ON comparable_transactions FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update comps"
  ON comparable_transactions FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete comps"
  ON comparable_transactions FOR DELETE
  TO authenticated
  USING (true);

-- Service role for auto-suggestions from scraper
CREATE POLICY "Service role can manage comps"
  ON comparable_transactions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
