CREATE TABLE IF NOT EXISTS acquisition_activity_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID NOT NULL REFERENCES acquisition_leads(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  channel     TEXT NOT NULL,
  direction   TEXT NOT NULL DEFAULT 'Outbound',
  notes       TEXT,
  response    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE acquisition_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read acquisition activity"
  ON acquisition_activity_log FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert acquisition activity"
  ON acquisition_activity_log FOR INSERT TO authenticated WITH CHECK (true);
