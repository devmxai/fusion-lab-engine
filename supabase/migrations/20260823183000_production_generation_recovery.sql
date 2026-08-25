-- Provider callbacks are the fast path; this database-owned scheduler is the
-- durable safety net when a browser closes or a callback is delayed/missed.
-- It never submits a new generation. It only re-reads already-known tasks.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
DECLARE existing_job bigint;
BEGIN
  SELECT jobid INTO existing_job FROM cron.job WHERE jobname = 'fusionlab-production-recovery-v1' LIMIT 1;
  IF existing_job IS NOT NULL THEN PERFORM cron.unschedule(existing_job); END IF;
END $$;

SELECT cron.schedule(
  'fusionlab-production-recovery-v1',
  '* * * * *',
  $job$
    SELECT net.http_get(
      url := 'https://fusionlab.pro/api/engine/v2/internal/recovery',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || coalesce((
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'fusionlab-production-recovery-secret'
          LIMIT 1
        ), 'not-configured'),
        'User-Agent', 'fusionlab-supabase-recovery/1.0'
      ),
      timeout_milliseconds := 25000
    );
  $job$
);
