-- URGENT: close unauthenticated (anon) access to the Fuse CRM database.
-- Verified 2026-07-28 against project puzfqevdphncajcjkvha.
--
-- WHAT IS WRONG
--   The `anon` role holds SELECT/INSERT/UPDATE/DELETE/TRUNCATE on all 42 public tables.
--   16 of those tables also carry an RLS policy for Postgres role `public` with USING(true),
--   and `public` includes `anon`. The anon key is embedded in the deployed frontend bundle,
--   so anyone on the internet can read (and on 7 tables, write) those rows with no login.
--   Worst case: user_gmail_settings exposes plaintext Google OAuth refresh tokens for 6 staff.
--
-- WHY THIS IS SAFE TO APPLY
--   `authenticated` holds its own identical grants on all 42 tables, so the logged-in app is
--   unaffected. The frontend only ever reads owner_name/gmail_email/calendar_link from
--   user_gmail_settings (PrivateWireLeads.jsx:629,681) and only ever upserts
--   owner_name/calendar_link/updated_at (PrivateWireLeads.jsx:792-795) — never the tokens.
--   Edge functions use service_role, which is untouched.
--
-- SEPARATE MANUAL STEP (cannot be done in SQL, and must be done by a human):
--   These 6 refresh tokens must be treated as compromised and REVOKED in Google, then re-consented:
--   https://myaccount.google.com/permissions  (or Google Workspace admin → Security → API controls)
--   Revoking access in Google is the only thing that invalidates an already-leaked refresh token.

begin;

-- 1. Remove all anon data-plane access. This is the single statement that closes the hole.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- Stop future tables from silently re-granting to anon.
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- 2. Lock the token table down to service_role, and expose only non-secret columns
--    to logged-in staff (which is all the app actually reads).
drop policy if exists "Allow all for internal tool" on public.user_gmail_settings;

create policy gmail_settings_read_nonsecret
  on public.user_gmail_settings for select to authenticated using (true);
create policy gmail_settings_upsert
  on public.user_gmail_settings for insert to authenticated with check (true);
create policy gmail_settings_update
  on public.user_gmail_settings for update to authenticated using (true) with check (true);
create policy gmail_settings_service
  on public.user_gmail_settings for all to service_role using (true) with check (true);

-- Column-level: table-level SELECT would cover every column, so revoke it and re-grant
-- only the columns the frontend actually uses. Tokens become unreadable to any browser session.
revoke select, insert, update on public.user_gmail_settings from authenticated;
grant  select (id, owner_name, gmail_email, calendar_link, token_expiry, created_at, updated_at)
  on public.user_gmail_settings to authenticated;
grant  insert (id, owner_name, gmail_email, calendar_link, updated_at)
  on public.user_gmail_settings to authenticated;
grant  update (owner_name, gmail_email, calendar_link, updated_at)
  on public.user_gmail_settings to authenticated;

commit;

-- VERIFY AFTER APPLYING (should return zero rows / an error, not data):
--   curl -s "https://puzfqevdphncajcjkvha.supabase.co/rest/v1/user_gmail_settings?select=refresh_token" \
--     -H "apikey: <anon key>"
--   curl -s "https://puzfqevdphncajcjkvha.supabase.co/rest/v1/leads?select=id" -H "apikey: <anon key>"
