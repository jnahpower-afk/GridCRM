-- ============================================================================
-- NEWS ARTICLES TABLE
-- Stores scraped energy news articles for the News dashboard
-- ============================================================================

CREATE TABLE IF NOT EXISTS news_articles (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title         TEXT NOT NULL,
  summary       TEXT,
  url           TEXT NOT NULL,
  source        TEXT NOT NULL,                -- 'newprojectmedia', 'bloomberg', 'bbc', 'ft'
  image_url     TEXT,
  published_at  TIMESTAMPTZ NOT NULL,
  scraped_at    TIMESTAMPTZ DEFAULT NOW(),

  -- Classification
  category      TEXT NOT NULL,                -- 'Development', 'Acquisitions', 'Policy', 'Grid & Infrastructure', 'Finance & Markets'
  technology    TEXT,                          -- 'Solar', 'Wind', 'BESS', 'Gas Peaker', 'Hydrogen', 'Nuclear', 'Hydro', 'Other Renewables', NULL if general
  region        TEXT,                          -- 'UK', 'Europe', 'Ireland', 'Spain', etc.

  -- Ranking
  relevance_score NUMERIC(4,2) DEFAULT 0,     -- 0-10 score for Grid CRM acquisition/development relevance

  -- Metadata
  created_at    TIMESTAMPTZ DEFAULT NOW(),

  -- Deduplication (unique on URL directly)
  UNIQUE (url)
);

-- Indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_news_published    ON news_articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_category     ON news_articles (category);
CREATE INDEX IF NOT EXISTS idx_news_technology   ON news_articles (technology);
CREATE INDEX IF NOT EXISTS idx_news_relevance    ON news_articles (relevance_score DESC);
CREATE INDEX IF NOT EXISTS idx_news_source       ON news_articles (source);
CREATE INDEX IF NOT EXISTS idx_news_scraped_date ON news_articles (scraped_at);

-- Row Level Security
ALTER TABLE news_articles ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read news
CREATE POLICY "Authenticated users can read news"
  ON news_articles FOR SELECT
  TO authenticated
  USING (true);

-- Only service role can insert/update (from Edge Function)
CREATE POLICY "Service role can manage news"
  ON news_articles FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
