-- Private Wire / Data Centres: Gmail → Touch point auto-sync.
-- Applied to prod via the Management API; recorded here for traceability.
-- Pairs with edge function `sync-privatewire-email` (hourly).

-- Dedup key: each synced email logs exactly one activity row, keyed by its
-- Gmail message id. The UNIQUE index makes the hourly re-scan idempotent.
alter table private_wire_activity_log add column if not exists gmail_message_id text;
create unique index if not exists uq_pw_activity_gmail_msg
  on private_wire_activity_log (gmail_message_id) where gmail_message_id is not null;

-- Per-mailbox sync cursor. Null = never synced → the function stamps now() and
-- skips history ("going forward only"); later runs scan since this timestamp.
alter table user_gmail_settings add column if not exists pw_synced_at timestamptz;

-- Do not schedule the hourly call until `sync-privatewire-email` is deployed
-- and the Grid CRM project has its Gmail OAuth secrets. Scheduling it before
-- then would create a permanently failing cron job. Configure the call with a
-- real project credential at deployment time rather than committing a secret.
