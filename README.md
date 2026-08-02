# Order Pilot

An n8n-based AI support agent for a WooCommerce food delivery store. It answers product/FAQ
questions with retrieval-augmented generation (RAG), looks up live order status by verifying
order number + billing email, and routes complaints to human escalation — all through a single
chat webhook.

## How it works

A customer message comes in through the chat webhook and is classified into one of three
intents using a free regex/keyword heuristic (no extra LLM call):

- **Product / FAQ questions** → embedded with OpenAI, matched against a Supabase pgvector store
  of FAQ + product content, and answered by Claude grounded only in the retrieved context. If
  nothing relevant is found, the customer gets a canned fallback instead of a guessed answer.
- **Order status questions** → routed to a sub-workflow that looks up the order via the
  WooCommerce REST API and verifies the provided email matches the order's billing email
  before revealing any details. Any mismatch (wrong order number, wrong email, or not found)
  returns the same generic "couldn't verify" message, so nothing leaks about which part was
  wrong.
- **Complaints / unresolvable issues** → routed to an escalation path (placeholder reply today;
  full email escalation is a later phase).

## Stack

- **Automation**: [n8n](https://n8n.io) (self-hosted)
- **LLM**: Anthropic Claude
- **Vector store**: Supabase (Postgres + pgvector)
- **Embeddings**: OpenAI `text-embedding-3-small`
- **Store**: WooCommerce REST API
- **Ingestion scripts**: TypeScript, run via [tsx](https://github.com/privatenumber/tsx)

## Project structure

```
n8n/
  rag-chat-workflow.json       Main chat webhook: intent routing, RAG, escalation
  order-lookup-workflow.json   Order lookup sub-workflow (order number + email verification)
  retrieval-test-workflow.json Standalone retrieval test webhook
src/
  lib/            Shared helpers: Postgres pool, OpenAI embeddings, WooCommerce API client
  scripts/        Ingestion and connectivity test scripts
  data/faqs.json  FAQ content, one Q&A pair per chunk
PROJECT_NOTES.md  Running build log: decisions, gotchas, and open items per phase
```

## Setup

1. Copy `.env.example` to `.env` and fill in:
   - Supabase Postgres connection details (session pooler)
   - `OPENAI_API_KEY`
   - `WOOCOMMERCE_URL`, `WOOCOMMERCE_CONSUMER_KEY`, `WOOCOMMERCE_CONSUMER_SECRET`
2. Install dependencies: `npm install`
3. Verify the database connection: `npm run test:connection`
4. Ingest content into the vector store:
   - `npm run ingest:faqs`
   - `npm run ingest:products`
5. Sanity-check retrieval: `npm run test:retrieval -- "<a question>"`
6. Import the workflows under `n8n/` into your n8n instance, wire up the credentials
   (Anthropic, OpenAI Header Auth, Postgres, WooCommerce), and re-point the main workflow's
   "Execute Order Lookup" node at the imported order-lookup workflow (its target ID is
   assigned on import and can't be hardcoded in the JSON).

## Status

Phase 2 of 6 complete: ingestion pipeline, RAG chat workflow, order lookup, and intent-based
routing are built and verified end-to-end against live n8n + WooCommerce. See
`PROJECT_NOTES.md` for the full history, current gotchas, and what's next (email escalation,
chat widget frontend).
