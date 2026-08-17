-- One-off: Dany Dbaibo left Private Wire. Reassign all his PW leads 50/50 to
-- Charlie Armitage and Sanidhya Mandowara (deterministic split by id).
-- Applied to remote via Management API; recorded here for traceability.
-- 3,092 PW leads → 1,546 Charlie / 1,546 Sanidhya. DC leads (if any) untouched.
-- Old owner is preserved in crm_audit.changes, so this is reversible.

with ranked as (
  select id, ntile(2) over (order by id) as bucket
  from private_wire_leads
  where owner = 'Dany Dbaibo' and (campaign = 'PW' or campaign is null)
)
update private_wire_leads l
  set owner = case r.bucket when 1 then 'Charlie Armitage' else 'Sanidhya Mandowara' end,
      updated_at = now()
  from ranked r
  where l.id = r.id;
