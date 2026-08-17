-- Gmail OAuth settings per team member
-- Stores connection status, Gmail address, calendar link, and OAuth tokens
-- Run this in the Supabase SQL editor

CREATE TABLE IF NOT EXISTS user_gmail_settings (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_name     text        NOT NULL UNIQUE,   -- e.g. "Laurie Campbell"
  gmail_email    text,                           -- confirmed Gmail address after OAuth
  calendar_link  text,                           -- e.g. https://calendar.app.google/xxx
  refresh_token  text,                           -- long-lived, used to get new access tokens
  access_token   text,                           -- short-lived, refreshed by edge function
  token_expiry   timestamptz,                    -- when access_token expires
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- Allow full access (internal tool, no auth required)
ALTER TABLE user_gmail_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for internal tool" ON user_gmail_settings
  FOR ALL USING (true) WITH CHECK (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_user_gmail_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_gmail_settings_updated_at
  BEFORE UPDATE ON user_gmail_settings
  FOR EACH ROW EXECUTE FUNCTION update_user_gmail_settings_updated_at();
