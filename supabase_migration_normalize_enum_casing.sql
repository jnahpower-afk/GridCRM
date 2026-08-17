-- Normalize enum casing on the sequence + activity tables and keep it clean.
-- Root problem: an external bulk process writes capitalized values
-- (sequence_enrolments.status 'Active', sequence_tasks.status 'Pending'/'Completed',
-- private_wire_activity_log.direction casing) that the app-side lowercase filters
-- silently miss. Rather than a CHECK constraint (which would break that external
-- writer), a BEFORE trigger coerces casing on write so storage stays consistent
-- regardless of source.
--
-- Canonical forms:
--   sequence_enrolments.status        -> lower()   (active, cancelled, completed, …)
--   sequence_tasks.status             -> lower()   (pending, completed, skipped, cancelled)
--   private_wire_activity_log.direction -> initcap() (Outbound, Inbound, Internal, Note)

-- ── Normalizer functions ──────────────────────────────────────────────────────
create or replace function normalize_status_lower()
returns trigger language plpgsql as $$
begin
  if new.status is not null then new.status := lower(new.status); end if;
  return new;
end;
$$;

create or replace function normalize_direction_initcap()
returns trigger language plpgsql as $$
begin
  if new.direction is not null then new.direction := initcap(new.direction); end if;
  return new;
end;
$$;

-- ── Triggers (BEFORE INSERT OR UPDATE) ────────────────────────────────────────
drop trigger if exists trg_norm_status on sequence_enrolments;
create trigger trg_norm_status before insert or update on sequence_enrolments
  for each row execute function normalize_status_lower();

drop trigger if exists trg_norm_status on sequence_tasks;
create trigger trg_norm_status before insert or update on sequence_tasks
  for each row execute function normalize_status_lower();

drop trigger if exists trg_norm_direction on private_wire_activity_log;
create trigger trg_norm_direction before insert or update on private_wire_activity_log
  for each row execute function normalize_direction_initcap();

-- ── One-time backfill of existing rows ────────────────────────────────────────
update sequence_enrolments        set status = lower(status)      where status is not null and status <> lower(status);
update sequence_tasks             set status = lower(status)      where status is not null and status <> lower(status);
update private_wire_activity_log  set direction = initcap(direction) where direction is not null and direction <> initcap(direction);
