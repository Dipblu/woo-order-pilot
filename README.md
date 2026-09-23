# Order Pilot

An AI customer-support agent for WooCommerce stores, built on self-hosted n8n.
It answers product and policy questions from a vector knowledge base, looks up
order status against the WooCommerce REST API with identity verification, and
escalates complaints to a human by email.

Running in production on a live food-delivery store.

---

## What it does

**Answers questions** — Retrieval-augmented generation over the store's FAQs,
policies and product catalogue. Content is embedded into Postgres/pgvector and
retrieved by cosine similarity, with a relevance threshold and an explicit
out-of-scope fallback rather than a hallucinated guess.

**Looks up orders** — Customers can ask where their order is. The agent
requires both an order number and the matching billing email before revealing
anything, and returns a deliberately generic error on any mismatch so the
endpoint can't be used to probe for valid order numbers.

**Remembers the conversation** — Order lookups are a two-step flow: the agent
asks for details, the customer replies with just an email and a number, and the
pending intent is resumed from session state. No re-explaining.

**Escalates complaints** — Complaint-classified messages trigger a real email
to the store owner with the question, session ID and timestamp. Escalations are
recorded with their delivery status, so a failed send is visible rather than
silent, and the customer gets an honest acknowledgement rather than a promise
nothing acts on.

**Alerts on new orders** — A WooCommerce webhook pushes each new order straight
to the owner's Telegram, so the store doesn't depend on anyone watching the
admin dashboard.

**Reports on itself** — Questions that fall below the relevance threshold, and
answers where the model hedged, are both logged to Postgres. A weekly digest
summarises them so knowledge-base gaps surface instead of going unnoticed.

---

## Architecture

```
Website widget (vanilla JS, Shadow DOM)
        │  POST { question, sessionId }
        ▼
  n8n: Order Pilot – Chat
        │
        ├─ Rate limit (IP-based, Postgres-backed) ──► throttle response
        ├─ Load pending intent (session state)
        ├─ Classify intent (regex/keyword, no LLM cost)
        │
        ├─ complaint    ──► SMTP escalation ──► log ──► acknowledgement
        ├─ order status ──► Order Lookup sub-workflow ──► WooCommerce REST
        └─ faq/product  ──► embed query ──► pgvector similarity
                             │
                             ├─ below threshold ──► log miss ──► fallback
                             └─ above threshold ──► Claude ──► answer
                                                     │
                                                     └─ hedged? ──► log
```

### Stack

| Layer | Choice |
|---|---|
| Orchestration | n8n, self-hosted (Docker/VPS) |
| LLM | Anthropic Claude |
| Embeddings | OpenAI `text-embedding-3-small` (1536-dim) |
| Vector store | Supabase Postgres + pgvector |
| Commerce | WooCommerce REST API + webhooks |
| Frontend | Single-file vanilla JS widget, Shadow DOM, no build step |
| Escalation | SMTP |
| Alerting | Telegram |
| Scripts | TypeScript/Node |

### Workflows

| Workflow | Purpose |
|---|---|
| `rag-chat-workflow.json` | Main agent — rate limiting, session state, intent routing, RAG, escalation |
| `order-lookup-workflow.json` | WooCommerce order lookup with order-number + billing-email verification |
| `new-order-alert-workflow.json` | WooCommerce webhook → Telegram alert to the store owner on each new order |
| `rate-limit-cleanup-workflow.json` | Daily prune of expired rate-limit rows |
| `weekly-digest-workflow.json` | Monday summary of unanswered questions and escalations |

`retrieval-test-workflow.json` is a development harness for checking similarity
search in isolation. Not part of the production path.

### Database

| Table | Purpose |
|---|---|
| `documents` | Embedded FAQ and product chunks |
| `pending_intents` | Per-session state for multi-turn order verification |
| `rate_limits` | Fixed-window request counts per IP |
| `escalations` | Complaint escalations and their email delivery status |
| `unanswered_questions` | Below-threshold misses and low-confidence answers |

---

## Status

**Phases 0–7 complete and live in production.** Five n8n workflows running.

Shipped:

- Ingestion pipeline with idempotent upserts (re-runnable without duplicates)
- RAG retrieval with relevance threshold and out-of-scope fallback
- Order lookup with two-factor verification and non-leaking error messages
- Intent routing across FAQ, order-status and complaint paths
- Chat widget, embedded site-wide, multi-turn context confirmed
- IP-based rate limiting, hardened against SQL injection and header spoofing
- Session state for two-step order flows
- SMTP complaint escalation with delivery-status tracking
- Real-time new-order alerts to Telegram via WooCommerce webhook
- Miss and low-confidence logging, plus a weekly digest

**Remaining:**

- Phase 8 — retrieval regression testing; audit of workflow JSON for unsafe
  `$json` references; migrations for the tables still created by hand
  (`documents`, `pending_intents`, `unanswered_questions`)
- Phase 9 — test coverage for order lookup, escalation and rate limiting

See `PROJECT_NOTES.md` for the full build log and known gotchas.

---

## Setup

### 1. Environment

Copy `.env.example` to `.env` and fill in:

- Supabase Postgres connection details (session pooler)
- `OPENAI_API_KEY` — embeddings only
- `WOOCOMMERCE_URL`, `WOOCOMMERCE_CONSUMER_KEY`, `WOOCOMMERCE_CONSUMER_SECRET`

### 2. Database

Run the migrations in `migrations/` against your Supabase project in numeric
order. `pgvector` must be enabled and the `documents` table must use 1536
dimensions to match the embedding model.

> Not every table has a migration yet — see the Phase 8 note above.

### 3. Install and verify

```bash
npm install
npm run test:connection
```

### 4. Ingest content

```bash
npm run ingest:faqs
npm run ingest:products
npm run test:retrieval -- "what's on the menu?"
```

> Editing content in WooCommerce or `faqs.json` changes nothing for the agent
> until the matching ingest script is re-run.

Intent classification has its own checks:

```bash
npm run test:intent       # classification against sample messages
npm run test:intent-sync  # verify the repo's classifier matches the live workflow
```

### 5. Import workflows

Import everything under `n8n/` into your n8n instance, then wire credentials:

| Credential | Used by |
|---|---|
| Anthropic | Answer generation |
| OpenAI (Header Auth) | Query embedding |
| Postgres | All database nodes |
| WooCommerce | Order lookup |
| SMTP | Complaint escalation |
| Telegram | New-order alerts and the weekly digest |

Then:

- Re-point **both** `Execute Order Lookup` nodes in the main workflow at the
  imported order-lookup workflow — there is one on the order-status path and
  one on the complaint path. Their target ID is assigned on import and can't
  be hardcoded in the JSON.
- Register the new-order webhook URL in **WooCommerce → Settings → Advanced →
  Webhooks**, triggering on order creation.
- Set the workflow timezone on the scheduled workflows.
- Publish all five workflows. Test URLs won't serve the live widget.

### 6. Embed the widget

Set your webhook URL in the widget config, upload `order-pilot-widget.js` to
your site, and load it with a single `<script src>` tag in the site footer.
See `WIDGET_README.md` for the WordPress/WPCode specifics.

---

## Notes for reuse

The project is being generalised into a redeployable template. Things that are
store-specific today: `faqs.json`, the WooCommerce credentials, the escalation
recipient, and the widget's branding and webhook URL.

Two patterns worth carrying into any fork:

**Never reference bare `$json` in a Code or Postgres node.** Nodes inserted
upstream reshape the item and the reference silently resolves to `undefined`
rather than erroring. Reference the source node explicitly —
`$('Webhook - Chat').item.json.body.question`. This caused several production
failures that produced plausible-looking but wrong behaviour, including intent
routing that appeared to work while never firing at all.

**A Postgres node returning zero rows outputs zero items and kills the
branch.** Write lookups and deletes so they always return exactly one row
(scalar subqueries, or a CTE with a count).