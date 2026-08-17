-- Log when a project reaches "Grid App Submitted" so we can estimate the grid
-- offer return date. Applies to greenfield_projects + dc_projects (shared UI).
alter table greenfield_projects add column if not exists grid_app_submitted_at date;
alter table dc_projects         add column if not exists grid_app_submitted_at date;

-- Stamp the date automatically when status transitions to 'Grid App Submitted'
-- (unless one is already provided, so manual edits win).
create or replace function stamp_grid_app_submitted()
returns trigger language plpgsql as $$
begin
  if new.status = 'Grid App Submitted'
     and new.grid_app_submitted_at is null
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    new.grid_app_submitted_at := current_date;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_grid_app_submitted on greenfield_projects;
create trigger trg_stamp_grid_app_submitted before insert or update on greenfield_projects
  for each row execute function stamp_grid_app_submitted();

drop trigger if exists trg_stamp_grid_app_submitted on dc_projects;
create trigger trg_stamp_grid_app_submitted before insert or update on dc_projects
  for each row execute function stamp_grid_app_submitted();
