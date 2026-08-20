-- Private Wire load-time optimisation (Phase 1).
-- Applied to prod via the Management API; recorded here for traceability.

-- Cheap tab-badge count: distinct leads with a pending task due today/overdue
-- for a given owner ('' = all owners). Replaces loading ~50k task rows just to
-- compute the badge. SECURITY INVOKER (default) so RLS still applies.
create or replace function pw_my_due_lead_count(p_owner text default '')
returns integer language sql stable as $$
  select count(distinct t.lead_id)::int
  from sequence_tasks t
  join private_wire_leads l on l.id = t.lead_id
  where t.status = 'pending'
    and t.due_date <= current_date
    and (l.campaign = 'PW' or l.campaign is null)
    and (p_owner = '' or l.owner = p_owner);
$$;
grant execute on function pw_my_due_lead_count(text) to authenticated, anon, service_role;

-- Partial index over pending tasks (ordered by due date) so the badge count and
-- the lazy Tasks-queue fetch use an index-only scan instead of scanning all
-- ~115k task rows.
create index if not exists idx_seq_tasks_pending_due
  on sequence_tasks (due_date, lead_id) where status = 'pending';
