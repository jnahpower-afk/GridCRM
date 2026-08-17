-- Auto-stop outreach when a lead advances or is lost.
-- When a private_wire_leads row's stage changes to a "stop outreach" stage, cancel
-- its active sequence enrolments and mark its pending sequence tasks as skipped.
-- Enforced at the DB layer so it fires no matter which path changes the stage
-- (manual edit, bulk update, API). Case-insensitive on stage + status so it stays
-- correct despite the existing enum-casing drift (active/Active, pending/Pending).
--
-- Stop stages: Meeting Booked, Proposal, Negotiation, Lost, Won.
-- Pending tasks are set to 'skipped' (not deleted) to match the app's own unenrol
-- behaviour and preserve history. Only active enrolments / pending tasks are touched.

create or replace function stop_sequence_on_stage_change()
returns trigger
language plpgsql
as $$
begin
  if new.stage is distinct from old.stage
     and lower(new.stage) in ('meeting booked', 'proposal', 'negotiation', 'lost', 'won') then

    update sequence_enrolments
      set status = 'cancelled', updated_at = now()
      where lead_id = new.id and lower(status) = 'active';

    update sequence_tasks
      set status = 'skipped'
      where lead_id = new.id and lower(status) = 'pending';

  end if;
  return new;
end;
$$;

drop trigger if exists trg_stop_sequence_on_stage_change on private_wire_leads;
create trigger trg_stop_sequence_on_stage_change
  after update of stage on private_wire_leads
  for each row
  execute function stop_sequence_on_stage_change();

-- One-time cleanup of the existing backlog: leads already sitting in a stop stage
-- with active enrolments / pending tasks (the trigger only fires on future changes).
update sequence_enrolments e
  set status = 'cancelled', updated_at = now()
  from private_wire_leads l
  where e.lead_id = l.id
    and lower(l.stage) in ('meeting booked', 'proposal', 'negotiation', 'lost', 'won')
    and lower(e.status) = 'active';

update sequence_tasks t
  set status = 'skipped'
  from private_wire_leads l
  where t.lead_id = l.id
    and lower(l.stage) in ('meeting booked', 'proposal', 'negotiation', 'lost', 'won')
    and lower(t.status) = 'pending';
