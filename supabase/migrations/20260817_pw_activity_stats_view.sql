-- Private Wire load-time optimisation (Phase 2).
-- Applied to prod via the Management API; recorded here for traceability.

-- Per-lead activity aggregates. Replaces the ~37k-row full-activity fetch on
-- section mount (8 paginated join queries, ~6.7s) with one group-by returning
-- one small row per lead (~0.4s). Full activity for a lead loads lazily on
-- selection. security_invoker so the querying user's RLS on the base table
-- applies.
create or replace view pw_lead_activity_stats with (security_invoker = true) as
select
  lead_id,
  max(date)                                                              as last_date,
  count(*) filter (where direction <> 'Inbound')                         as total_out,
  count(*) filter (where direction <> 'Inbound' and date = current_date) as today_out,
  count(*) filter (where direction <> 'Inbound' and date >= current_date - 7) as out_7d,
  count(*) filter (where date = current_date and response)               as resp_today
from private_wire_activity_log
group by lead_id;

grant select on pw_lead_activity_stats to authenticated, anon, service_role;
