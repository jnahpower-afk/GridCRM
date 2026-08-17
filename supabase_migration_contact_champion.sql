-- Champion contact feature.
-- 1. Flag a contact as the organisation's champion.
alter table private_wire_contacts add column if not exists is_champion boolean not null default false;

-- 2. Let an activity be attributed to a specific contact (org-level activity
--    keeps contact_id null). Set null on contact delete so activity history is
--    preserved.
alter table private_wire_activity_log
  add column if not exists contact_id uuid references private_wire_contacts(id) on delete set null;

create index if not exists idx_pw_activity_contact on private_wire_activity_log(contact_id);
