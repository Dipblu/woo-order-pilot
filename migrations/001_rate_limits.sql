-- 001_rate_limits.sql
-- Per-identifier request counters for the chat webhook's rate limiter.
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Design notes and the accompanying n8n node changes live in
-- widget/RATE_LIMITING.md. Not yet implemented in the live workflow.

CREATE TABLE IF NOT EXISTS rate_limits (
  identifier text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count int NOT NULL DEFAULT 1,
  PRIMARY KEY (identifier, window_start)
);

-- Optional cleanup, e.g. from a daily scheduled workflow:
-- DELETE FROM rate_limits WHERE window_start < now() - interval '2 days';
