-- Migration: portfolios — group projects acquired together as one deal.
-- Each project keeps its own DD, acquisition process and financial model;
-- the portfolio is purely a grouping plus deal-level context.

CREATE TABLE IF NOT EXISTS portfolios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  seller      text,
  notes       text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive unique name so "WSE" and "wse" can't both exist.
CREATE UNIQUE INDEX IF NOT EXISTS portfolios_name_lower_unique ON portfolios (lower(name));

-- Nullable: a project with no portfolio is a standalone acquisition.
-- ON DELETE SET NULL — removing a portfolio must never remove its projects.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS portfolio_id uuid
  REFERENCES portfolios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS projects_portfolio_id_idx ON projects (portfolio_id);

-- Match the access model used by projects (open visibility across the team).
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'portfolios' AND policyname = 'Authenticated full access') THEN
    CREATE POLICY "Authenticated full access" ON portfolios
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
