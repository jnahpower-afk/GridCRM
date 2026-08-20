-- Schedule the Slack end-of-day activity digest to run every weekday at 6pm UTC (7pm BST)
-- Run this in the Supabase SQL Editor

-- Enable required extensions (already enabled if morning digest is running)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove existing job if re-running
SELECT cron.unschedule('slack-activity-digest')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'slack-activity-digest');

-- Schedule: 6pm UTC (7pm BST), Monday–Friday
SELECT cron.schedule(
  'slack-activity-digest',
  '0 18 * * 1-5',
  format(
    $$
    SELECT net.http_post(
      url     := 'https://ndjwczcswxfivmyynohk.supabase.co/functions/v1/slack-activity-digest',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
    $$
  )
);

-- Confirm both jobs are scheduled
SELECT jobname, schedule, command FROM cron.job
WHERE jobname IN ('slack-task-digest', 'slack-activity-digest');
