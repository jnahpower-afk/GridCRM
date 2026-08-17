-- Project attachments backend
-- 1. Private storage bucket for uploaded project files (25 MB cap, any type)
insert into storage.buckets (id, name, public, file_size_limit)
values ('project-files', 'project-files', false, 26214400)
on conflict (id) do nothing;

-- 2. File-metadata columns on both activity tables (shared component: DC + Greenfield)
alter table dc_project_activity
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists file_size bigint,
  add column if not exists mime_type text;

alter table greenfield_project_activity
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists file_size bigint,
  add column if not exists mime_type text;

-- 3. Storage RLS: authenticated staff can manage objects in the project-files bucket
drop policy if exists "project_files_read"   on storage.objects;
drop policy if exists "project_files_insert" on storage.objects;
drop policy if exists "project_files_update" on storage.objects;
drop policy if exists "project_files_delete" on storage.objects;

create policy "project_files_read"   on storage.objects for select to authenticated using (bucket_id = 'project-files');
create policy "project_files_insert" on storage.objects for insert to authenticated with check (bucket_id = 'project-files');
create policy "project_files_update" on storage.objects for update to authenticated using (bucket_id = 'project-files');
create policy "project_files_delete" on storage.objects for delete to authenticated using (bucket_id = 'project-files');
