-- 005_pending_intents.sql
--
-- Back-filled migration. Created by hand in the Supabase SQL editor; this file
-- reproduces it for a fresh deployment.
--
-- Verified against the live database 2026-10-13 (information_schema.columns,
-- pg_constraint). Column types, nullability and the primary key match
-- production.
--
-- Used by three nodes in rag-chat-workflow.json:
--   "Load Pending Intent"   SELECT ... WHERE session_id = $1
--   "Save Pending Intent"   INSERT ... ON CONFLICT (session_id) DO UPDATE
--   "Clear Pending Intent"  DELETE WHERE session_id = $1

create table if not exists pending_intents (
  session_id        text primary key,
  pending_intent    text not null,
  order_number      text,
  email             text,
  original_question text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table pending_intents enable row level security;

-- session_id MUST be the primary key (or carry a unique constraint): "Save
-- Pending Intent" uses ON CONFLICT (session_id) DO UPDATE, which errors
-- without one. Confirmed live as pending_intents_pkey.
--
-- pending_intent is NOT NULL. "Save Pending Intent" passes it as $2, so a null
-- there fails the insert rather than storing a half-row -- which is the
-- behaviour you want: a pending intent with no intent is meaningless.
--
-- order_number is text, not an integer. It holds whatever the customer typed
-- and is passed straight to the WooCommerce lookup; platforms with prefixed or
-- non-numeric order numbers (#INV-1024) would break an integer column, and the
-- template is meant to survive a platform swap.
--
-- created_at is never written by any node -- only the default populates it.
-- updated_at is set explicitly by "Save Pending Intent" on both insert and
-- update, so the pair gives you row age and last-touch for free.
--
-- NO TTL / CLEANUP JOB EXISTS for this table. A session that starts an order
-- lookup and never supplies the details leaves a row behind permanently.
-- rate_limits has a scheduled cleanup workflow ("Order Pilot - Rate Limit
-- Cleanup", daily 3am); this table does not. Not urgent at current volume, but
-- it grows without bound. created_at makes the cleanup trivial when wanted:
--
--   delete from pending_intents where created_at < now() - interval '7 days';
--
-- Note the same gotcha that workflow hit: a Postgres node returning zero rows
-- outputs zero items and silently kills the branch, so write it as a CTE with
-- a count, the way "Delete Old Rate Limits" does.
