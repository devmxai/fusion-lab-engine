-- ============================================================
-- FusionLab: pg_cron Maintenance Jobs Setup
-- ============================================================
-- This file documents the scheduled maintenance jobs required
-- for production operation. These jobs run directly in PostgreSQL
-- via pg_cron (no HTTP endpoint needed — fully internal).
--
-- PREREQUISITES:
--   - pg_cron extension must be enabled
--   - pg_net extension must be enabled (already available in Supabase)
--
-- HOW TO APPLY:
--   Run this SQL via Supabase SQL Editor or psql on initial setup.
--   These are DATA operations (cron.schedule), not schema migrations,
--   so they should be run via the SQL editor, not as a migration.
--
-- IMPORTANT: This file is the single source of truth for all
--   scheduled maintenance. If you need to modify schedules,
--   update this file and re-run the relevant statements.
-- ============================================================

-- ── 1. Enforce Subscription Expiry ──
-- Runs every hour at :00
-- Marks active subscriptions as 'expired' when expires_at <= now()
SELECT cron.schedule(
  'system-expire-subscriptions',
  '0 * * * *',
  $$SELECT public.enforce_subscription_expiry();$$
);

-- ── 2. Cleanup Stale Credit Reservations ──
-- Runs every hour at :15
-- Releases credits from reservations stuck in 'reserved' for >4 hours
-- Credits are returned to user balance with a refund transaction
SELECT cron.schedule(
  'system-cleanup-reservations',
  '15 * * * *',
  $$SELECT public.cleanup_stale_reservations(4);$$
);

-- ── 3. Reconciliation Check ──
-- Runs every hour at :30
-- Detects anomalies: negative balances, stale reservations >2h
-- Results are logged for admin review
SELECT cron.schedule(
  'system-reconciliation',
  '30 * * * *',
  $$SELECT public.reconciliation_check();$$
);

-- ============================================================
-- To verify jobs are scheduled:
--   SELECT jobid, jobname, schedule, command FROM cron.job;
--
-- To unschedule a job:
--   SELECT cron.unschedule('system-expire-subscriptions');
--
-- To view job run history:
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
-- ============================================================
