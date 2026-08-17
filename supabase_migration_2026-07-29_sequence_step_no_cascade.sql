-- Stop a sequence-template edit from destroying outreach history.
-- Applied 2026-07-29 against project puzfqevdphncajcjkvha.
--
-- THE BUG
--   SequenceManager.jsx:76 deleted every step of a sequence on save and re-inserted them.
--   sequence_tasks.step_id was FK ON DELETE CASCADE, so one "Save" on the main sequence
--   ("Private Wire Cold Outreach", 8 steps) destroyed all 93,073 sequence_tasks attached to it
--   -- including 25,154 completed and 18,402 skipped rows, i.e. the entire record of outreach
--   ever performed. Localising templates for a new geography is exactly this action.
--
-- THE FIX (two parts)
--   1. App: SequenceManager.handleSave now UPDATEs steps in place and only deletes steps the
--      user genuinely removed, so step ids survive and tasks stay linked. (Primary fix.)
--   2. DB (this file): step_id becomes nullable with ON DELETE SET NULL, so even a genuine
--      step removal degrades history (task keeps its lead, date, status; loses the template
--      pointer) instead of deleting it. Defence in depth for the case above.
--
-- SAFE FOR THE FRONTEND: every read of step_id already uses optional chaining --
-- TaskQueue.jsx:274,277,363,364,369,426,459 all do stepsMap[t.step_id]?.channel, and
-- PrivateWireLeads.jsx:1373 uses .find(...) whose undefined result is already handled.
-- A null step_id therefore renders as "no template", not a crash.
--
-- NOT CHANGED (deliberate -- product decision, see note at end):
--   sequence_tasks.enrolment_id and sequence_enrolments.sequence_id remain ON DELETE CASCADE,
--   so deleting a whole SEQUENCE still deletes its history. That path is behind a confirm
--   dialog (SequenceManager.jsx:105). Consider archiving instead of deleting.

begin;

-- 1. Indexes first. sequence_tasks had ONLY a primary-key index on 93,091 rows, so every
--    referential action below (and TaskQueue's own filtering) was a full table scan.
--    The step_id index is a hard requirement for ON DELETE SET NULL to perform.
create index if not exists idx_sequence_tasks_step_id
  on public.sequence_tasks (step_id);
create index if not exists idx_sequence_tasks_lead_id
  on public.sequence_tasks (lead_id);
create index if not exists idx_sequence_tasks_enrolment_id
  on public.sequence_tasks (enrolment_id);

-- 2. Allow step_id to be null so the FK can null it rather than delete the row.
alter table public.sequence_tasks
  alter column step_id drop not null;

-- 3. Swap CASCADE for SET NULL.
alter table public.sequence_tasks
  drop constraint sequence_tasks_step_id_fkey;
alter table public.sequence_tasks
  add constraint sequence_tasks_step_id_fkey
  foreign key (step_id) references public.sequence_steps(id) on delete set null;

commit;

-- VERIFY:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'sequence_tasks_step_id_fkey';
--   -- expect: FOREIGN KEY (step_id) REFERENCES sequence_steps(id) ON DELETE SET NULL
