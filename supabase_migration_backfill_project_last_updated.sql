-- Backfill greenfield_projects / dc_projects last_updated from their latest
-- activity, so the "Updated" column reflects notes/emails/attachments rather
-- than being frozen at the Monday-import date. Applied via Management API.
-- (Going forward, the app bumps last_updated on note/upload/email-assign/edit.)

update greenfield_projects p
  set last_updated = a.mx
  from (select project_id, max(created_at) mx from greenfield_project_activity group by project_id) a
  where a.project_id = p.id and (p.last_updated is null or a.mx > p.last_updated);

update dc_projects p
  set last_updated = a.mx
  from (select project_id, max(created_at) mx from dc_project_activity group by project_id) a
  where a.project_id = p.id and (p.last_updated is null or a.mx > p.last_updated);
