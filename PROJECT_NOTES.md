# Order Pilot - Project Notes

I'm building an n8n AI support agent for my WooCommerce store (RAG for product/FAQ inquiries,
live order lookups, email escalation for complaints). Phase 1 of 6 (Knowledge Base Ingestion)
is now complete — see below. Next up: Phase 2.

Stack:
- n8n: self-hosted (Docker/VPS)
- LLM: Anthropic Claude
- Vector store: Supabase (Postgres + pgvector)
- Frontend: custom chat widget (not built yet)
- Escalation: email
- Language: JavaScript/TypeScript for ingestion scripts, widget, and n8n code nodes
- Also using Claude Code (Windows) alongside chat for implementation work

Context from Phase 0:
- Credentials configured and tested in n8n: "Anthropic account" (Anthropic API), "WooCommerce
  account 2" (WooCommerce REST API, Read/Write), "Postgres account" (Postgres, pooler connection)
- Supabase project: ref gsvuwkovuwmjfqzupjjx, region ap-northeast-2 (Seoul). Pooler host is
  aws-1-ap-northeast-2.pooler.supabase.com, session pooler, port 5432, SSL Require, user
  postgres.gsvuwkovuwmjfqzupjjx
- `vector` extension enabled and confirmed via pg_extension query
- `documents` table created (id bigserial, content text, metadata jsonb, embedding vector(1536)) —
  RLS enabled, no policies yet (n8n connects via Postgres role directly, bypassing RLS)
- Still need: a native Supabase credential (project URL + service_role key) for n8n's Supabase
  Vector Store node

Decisions made in Phase 1 so far:
- Embedding model: OpenAI text-embedding-3-small (1536 dim, matches existing table)
- Ingestion approach: direct Postgres upsert (not the Supabase Vector Store node), for
  idempotent re-syncs
- FAQ content authored as faqs.json, one Q&A pair per chunk
- Product content pulled live from WooCommerce REST API

Phase 1 progress:
- Project scaffolded: package.json (type: module), tsconfig.json, .env / .env.example,
  .gitignore. Scripts run via `tsx`.
- src/lib/db.ts — pg Pool for the Supabase session pooler (SSL, rejectUnauthorized: false)
- src/lib/embeddings.ts — shared `embed(texts)` helper calling OpenAI's embeddings endpoint
  directly via fetch (no SDK dependency), batches in groups of 100
- src/lib/woocommerce.ts — `fetchAllProducts()`, paginates the WC REST API (Basic Auth,
  per_page 100, follows X-WP-TotalPages) for published products only
- src/scripts/test-connection.ts — verifies DB connectivity, pgvector extension, documents
  row count (`npm run test:connection`)
- src/scripts/ingest-faqs.ts — reads src/data/faqs.json, embeds `Q:/A:` formatted content,
  deletes+reinserts rows where metadata->>'source' = 'faq' (`npm run ingest:faqs`)
- src/scripts/ingest-products.ts — fetches products, formats name/SKU/price/stock/
  categories/description (HTML stripped) into content, deletes+reinserts rows where
  metadata->>'source' = 'product' (`npm run ingest:products`)
- Both ingestion scripts are idempotent full-resyncs scoped by `metadata->>'source'`, so they
  don't touch each other's rows and can be safely rerun after editing source content
- Verified end-to-end: 12 FAQ rows + 9 product rows = 21 rows in `documents`
- faq-008 and faq-011 placeholder answers fixed and re-ingested: faq-008 now points to
  dennisphx18@gmail.com and https://www.facebook.com/dennis.hermoso1; faq-011 now states
  scheduled/advance ordering isn't supported yet, same-day only
- Gotcha hit during setup: the WooCommerce REST API key from Phase 0 stopped authenticating
  (401 woocommerce_rest_cannot_view) even with correct Read/Write permission and an
  Administrator-owned key — regenerating the key/secret in wp-admin and updating .env fixed it
- src/scripts/test-retrieval.ts (`npm run test:retrieval -- "<question>"`) — embeds a sample
  question and runs a pgvector cosine similarity search (`embedding <=> query`) against
  `documents`, top 5 results with similarity score. Verified working: a delivery-time question
  correctly ranked the matching FAQ top with a clear margin (0.67 vs 0.44 next); a "spicy food"
  question surfaced the right product ("Sweet and Spicy Laing") alongside relevant FAQ content
  — confirms retrieval works across both FAQ and product sources before wiring into n8n
- Noticed while testing retrieval: all WooCommerce products show category "Uncategorized" —
  worth checking in wp-admin whether products actually have categories assigned, since that's
  a field RAG answers could use (e.g. "what desserts do you have")

n8n workflows (Phase 1 complete — retrieval wired into n8n and verified):
- n8n/retrieval-test-workflow.json — Webhook (POST /retrieval-test) → Get Embedding (OpenAI,
  via new "OpenAI API (Header Auth)" credential) → Similarity Search (Postgres, pgvector
  cosine query) → Respond to Webhook with raw matched chunks. Confirmed working end-to-end.
- n8n/rag-chat-workflow.json — same retrieval steps, then: Check Relevance (Code node —
  joins top-5 chunks into context, flags topSimilarity < 0.2 as belowThreshold) → Relevance
  Check (IF node) branches to either No Match Response (canned reply pointing to
  dennisphx18@gmail.com / Facebook, skips Claude entirely) or Ask Claude (Anthropic Messages
  API via HTTP Request using the existing "Anthropic account" credential, model
  claude-sonnet-5, system prompt constrains answers to the provided context) → Format
  Response → Respond to Webhook.
- Both branches of rag-chat-workflow confirmed working live: an off-topic question
  ("what's the weather today?") correctly triggered the canned No Match Response; an in-scope
  question ("How long will my delivery take?") correctly triggered Claude and returned a
  grounded answer using retrieved context.
- Gotcha: this n8n instance's "Publish"/Active toggle for production webhook URLs
  (https://dmhermoso.cloud/webhook/chat) didn't reliably register during testing — the Test
  URL flow (https://dmhermoso.cloud/webhook-test/chat, requires clicking "Listen for test
  event" before each call) was the reliable way to test. Worth revisiting production
  activation before going live with a real frontend.
- Similarity threshold (0.2) is an untuned starting point based on a handful of manual test
  queries, not real traffic — revisit once there's actual usage data.

Open items:
- Order identity verification approach (how to confirm a customer before showing order
  details) — not yet decided
- Complaint escalation is routing-only logic, no RAG content needed
- Product categories all show "Uncategorized" in WooCommerce — confirm if intentional
- Production webhook activation ("Publish"/Active toggle) didn't reliably work during
  testing — needs investigation before relying on it for a live frontend
- Similarity threshold (0.2) untuned, needs revisiting with real usage data
- Custom chat widget frontend not started
- Phase 2+ scope not yet defined (order lookups, identity verification, escalation routing,
  widget)
