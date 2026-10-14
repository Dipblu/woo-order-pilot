-- 004_documents.sql
--
-- Back-filled migration. The documents table was created by hand in the
-- Supabase SQL editor before migrations existed; this file reproduces it so a
-- fresh deployment can be stood up without manual steps.
--
-- Verified against the live database 2026-10-13 (information_schema.columns,
-- pg_attribute, pg_constraint). Column types, nullability and the primary key
-- match production.
--
-- metadata shapes written by the ingest scripts:
--   FAQ      { source: 'faq',     faq_id, question }
--   Product  { source: 'product', product_id, sku, name, permalink }
-- Both scripts resync by deleting WHERE metadata->>'source' = '<kind>' and
-- re-inserting, so the source key is load-bearing, not decorative.

create extension if not exists vector;

create table if not exists documents (
  id        bigserial primary key,
  content   text,
  metadata  jsonb,
  embedding vector(1536)
);

alter table documents enable row level security;

-- content and metadata are nullable in production. Left that way deliberately
-- so a fresh deployment matches; the ingest scripts always supply both.
--
-- embedding is declared vector(1536), not bare vector, so the dimension is
-- enforced at the column and a wrong-sized vector is rejected at insert rather
-- than silently stored. 1536 = OpenAI text-embedding-3-small. Changing the
-- embedding model changes this number AND invalidates every stored vector:
-- the table has to be re-ingested, not migrated.

-- ---------------------------------------------------------------------------
-- NOT CREATED: an approximate-nearest-neighbour index.
--
-- Similarity Search uses the cosine operator <=> with no index, so it does an
-- exact scan and returns the true top 5. An HNSW or IVFFlat index would make
-- that search APPROXIMATE -- faster, but it can miss the true nearest rows.
--
-- The relevance threshold (0.2, Check Relevance) and the low-confidence floor
-- (0.5, Should Log Low Confidence?) were both tuned by eye against exact
-- search results. Adding an ANN index would shift retrieval quietly, with no
-- error and no log -- the failure mode this project has hit repeatedly.
--
-- Add it when a deployment's corpus is large enough that exact scan is slow
-- (thousands of chunks, not dozens), and re-check both thresholds afterwards:
--
--   create index on documents using hnsw (embedding vector_cosine_ops);
--
-- Use hnsw rather than ivfflat on a fresh deployment: ivfflat needs
-- representative data present at build time to pick its lists parameter, so it
-- builds badly on an empty table.
-- ---------------------------------------------------------------------------

-- Optional, result-neutral: both ingest scripts filter on metadata->>'source'
-- every run. Not present on the live database as of 2026-10-13 -- enable this
-- only if you also add it to production, or the two will diverge.
--
--   create index if not exists documents_source_idx
--     on documents ((metadata ->> 'source'));
