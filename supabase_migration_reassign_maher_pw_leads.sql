-- One-off: reassign all Maher Chaabane leads to Charlie Armitage.
-- Applied to remote via Management API; recorded here for traceability.
-- 523 PW leads (Maher had no DC leads). Old owner preserved in crm_audit.changes.

update private_wire_leads
  set owner = 'Charlie Armitage', updated_at = now()
  where owner = 'Maher Chaabane';
