-- Migration: Add fm_version to model_runs for multi-version FM support
-- Version mapping: 1 = NBO FM, 2 = FABO FM, 3 = FID FM

-- Add fm_version column to model_runs (defaults to 1 so existing rows become NBO)
ALTER TABLE model_runs ADD COLUMN IF NOT EXISTS fm_version integer DEFAULT 1;

-- Add a unique constraint so we can upsert model_runs by (project_id, fm_version)
-- First drop any existing model_runs that are duplicates (keep latest per project)
-- Then add the constraint
DO $$
BEGIN
  -- Delete older duplicate runs per project, keeping the most recent
  DELETE FROM model_runs a
  USING model_runs b
  WHERE a.project_id = b.project_id
    AND a.fm_version = b.fm_version
    AND a.created_at < b.created_at;

  -- Add unique constraint if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'model_runs_project_version_unique'
  ) THEN
    ALTER TABLE model_runs ADD CONSTRAINT model_runs_project_version_unique
      UNIQUE (project_id, fm_version);
  END IF;
END $$;

-- Add fm_created_at to project_inputs to track when each FM version was first created
ALTER TABLE project_inputs ADD COLUMN IF NOT EXISTS fm_created_at timestamptz;

-- Set fm_created_at for existing rows to their created_at
UPDATE project_inputs SET fm_created_at = created_at WHERE fm_created_at IS NULL;
