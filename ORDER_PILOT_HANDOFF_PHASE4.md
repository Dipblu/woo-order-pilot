# Order Pilot — Phase 4 Handoff (Debugging + Hardening)

**Paste this at the start of the next conversation to continue without context drift.**

---

## Project snapshot

| Item | Value |
|---|---|
| Project | Order Pilot — AI support agent for a WooCommerce food delivery store |
| Live store | cociniña.com (WordPress + WooCommerce, Astra theme + Elementor) |
| Business name | Cociniña |
| n8n instance | https://dmhermoso.cloud (self-hosted, nginx 1.24 direct — no Cloudflare/CDN) |
| Chat webhook | https://dmhermoso.cloud/webhook/chat (JSON body key is `question`, NOT `message`) |
| Order-lookup webhook | https://dmhermoso.cloud/webhook/order-lookup |
| Vector store | Supabase (Postgres + pgvector), region ap-northeast-2 |
| Supabase host | aws-1-ap-northeast-2.pooler.supabase.com / db `postgres` / user `postgres.gsvuwkovuwmjfqzupjjx` |
| Embeddings | OpenAI text-embedding-3-small (1536 dim) |
| LLM | Anthropic Claude (model string in workflow: `claude-sonnet-5`) |
| Local repo | `C:\Users\My PC\Projects\Woo-Chatbot` |
| GitHub | Private repo: github.com/Dipblu/woo-order-pilot (latest commit `fe83c84`) |
| Test order | WooCommerce order #754 (zero-value, "processing") — left in place intentionally |

Phases 0–3 are complete. Phase 3 (widget + rate limiting) is live in production.
This document covers the debugging/hardening work that followed.

---

## Repo layout (relevant parts)

```
Woo-Chatbot/
├── n8n/
│   ├── rag-chat-workflow.json      ← main workflow (synced as of fe83c84)
│   ├── order-lookup-workflow.json
│   └── retrieval-test-workflow.json
├── src/
│   ├── data/faqs.json              ← 14 FAQ entries (faq-001 … faq-014)
│   └── scripts/
│       ├── ingest-faqs.ts          ← npm run ingest:faqs
│       ├── ingest-products.ts      ← npm run ingest:products (pulls live from WooCommerce API)
│       ├── test-connection.ts
│       └── test-retrieval.ts
├── migrations/001_rate_limits.sql
├── widget/
└── .env                            ← SUPABASE_DB_* connection vars
```

**Ingest commands** (must `cd "C:\Users\My PC\Projects\Woo-Chatbot"` first):
- `npm run ingest:faqs` — full resync of `source='faq'` rows (DELETE + re-INSERT, transactional)
- `npm run ingest:products` — full resync of `source='product'` rows, fetched live from WooCommerce

Each script only touches its own `source` tag, so they're safe to run independently.

---

## Current data state (Supabase `documents` table)

- 14 rows with `source='faq'` (faq-001 … faq-014)
- 9 rows with `source='product'` (the menu items, ingested from WooCommerce "Shop")
- The 9 dishes: Ginataang Hipon, Tofu Sisig, Pork Adobo, Lumpiang Shanghai,
  Special Chicken Adobo, Crispy Lechon Kawali (note: product name in WooCommerce is
  misspelled "Crisply Lechong Kawali"), Sizzling Sisig, Chicken Curry, Sweet and Spicy Laing

---

## Bugs found and FIXED this session

### 1. Query embedding never used the real customer question (CRITICAL — fixed)

The **Get Embedding** node's JSON body was:

```
{{ JSON.stringify({ model: "text-embedding-3-small", input: $json.question || "How long will my delivery take?" }) }}
```

`$json.question` was **undefined** at that point in the flow (the item gets reshaped
upstream), so *every single query* silently fell back to the hardcoded string
`"How long will my delivery take?"`. This meant no customer question was ever actually
being embedded or searched — `faq-002` (delivery time) always won, and scores barely
varied across wildly different phrasings.

**Fixed to:**
```
{{ JSON.stringify({ model: "text-embedding-3-small", input: $('Webhook - Chat').item.json.body.question || "How long will my delivery take?" }) }}
```

**Lesson carried forward:** in this workflow, always reference `$('Webhook - Chat')`
directly for original request data rather than a bare `$json`.

### 2. Response parsing broke on Claude thinking blocks (fixed)

The **Format Response** node used:

```js
const reply = $json.content?.[0]?.text ?? "Sorry, I couldn't generate a response.";
```

`claude-sonnet-5` *sometimes* returns an extended-thinking block at `content[0]`, which
has no `.text` field — putting the real answer at `content[1]`. When that happened the
parse returned undefined and the customer saw "Sorry, I couldn't generate a response"
even though Claude had answered perfectly. **Non-deterministic**, which made it very
confusing to diagnose.

**Fixed to:**
```js
const blocks = $json.content ?? [];
const textBlock = blocks.find(b => b.type === "text");
const reply = textBlock?.text ?? "Sorry, I couldn't generate a response.";
return [{ json: { answer: reply } }];
```

### 3. Content gaps (fixed)

- Ran `npm run ingest:products` — the 9 menu items had never been ingested at all.
- Added **faq-013** ("What's on the menu?") — a menu-overview chunk, because per-dish
  product chunks don't match broad/aggregate queries well.
- Added **faq-014** (recommendations / best seller / most popular) — cold-start
  "what do you recommend?" matched nothing otherwise. **The 4 dishes named in faq-014
  are placeholders, not real sales data** — worded as suggestions, not factual
  best-seller claims. Update in `faqs.json` + re-run `ingest:faqs` when real order
  data exists.

All three confirmed working in production via the widget.

---

## THE OPEN PROBLEM — pick up here

### Symptom

Sending **"how do I change a car tire?"** (a deliberately out-of-scope question, meant
to force a genuine below-threshold miss) returns this in the widget:

> "I got a response back but couldn't read it — could you try rephrasing, or ask to
> speak with a person?"

This is a **third distinct failure message**, different from both:
- the No Match Response node's text ("I'm not able to find information about that in
  our knowledge base. For further help, please email dennisphx18@gmail.com or message
  us on Facebook at https://www.facebook.com/dennis.hermoso1")
- the Format Response fallback ("Sorry, I couldn't generate a response.")

The wording strongly suggests it's the **widget's own client-side error handling**
firing when it receives a response it can't parse — i.e. the workflow returned
something, but without a valid `answer` field.

### Next diagnostic step (was about to do this when the session ended)

1. In n8n → **Executions**, open the newest run (the "how do I change a car tire?" one).
2. Screenshot/inspect the whole canvas — which path lit up green, and does any node
   show a red error?
3. Specifically check: did it go down the **Relevance Check → false → No Match Response**
   branch this time (a real below-threshold miss), or somewhere else?
4. Then inspect **Respond to Webhook**'s input to see what JSON actually got returned.

**Important diagnostic gotcha learned the hard way:** clicking a node on the *Editor*
canvas shows cached/live-editor state, NOT the historical execution. Always go to the
**Executions** tab, open the specific run, and click the node *inside that execution
view*. If you see an "Execute previous nodes to view input data" prompt, you're looking
at the Editor, not the execution.

---

## Also still open

### A. `unanswered_questions` logging — built but NEVER VERIFIED

Table created in Supabase:

```sql
create table unanswered_questions (
  id bigint generated always as identity primary key,
  question text not null,
  session_id text,
  reason text not null,
  similarity_score float,
  answer_given text,
  created_at timestamptz not null default now()
);
```

A Postgres node named **"Log Below-Threshold Miss"** is wired in as:
`No Match Response → Log Below-Threshold Miss → Respond to Webhook`

Its query:
```sql
INSERT INTO unanswered_questions (question, session_id, reason, similarity_score)
VALUES ($1, $2, 'below_threshold', $3)
RETURNING id, created_at
```

Query Parameters:
```
{{ [$('Webhook - Chat').item.json.body.question, $('Webhook - Chat').item.json.body.sessionId, $('Check Relevance').item.json.topSimilarity] }}
```

**It has never successfully written a row.** Every test case that *looked* like a hard
fail turned out to be bug #2 (the thinking-block parse) going down the Claude branch
instead. The node shows green because it receives **zero input items** when the
No Match branch doesn't fire — and a Postgres node with 0 items runs 0 queries while
still reporting success. The only rows in the table are two manual test inserts
(id 1 and 2, "test question"), which confirmed the table itself accepts writes fine.

Verifying this is blocked on solving the open problem above (we need a genuine
below-threshold miss to actually reach the node).

### B. Soft-fail logging — not built yet

Because the relevance threshold is only **0.2** (very permissive), most real failures
won't hit the No Match branch at all — they'll be Claude answering with "I'm not sure
/ I don't have that information." Plan: after Format Response, detect decline-style
phrasing and log with `reason='low_confidence_answer'` plus the `answer_given` text.

### C. Small cleanup items (carried from Phase 3)

1. **Duplicate WPCode snippet** — snippet ID 756 (Admin footer) is deactivated but not
   deleted. Safe to delete.
2. **No cleanup job for `rate_limits`** — a daily
   `DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'` is
   documented but not scheduled. Not urgent at current row counts.
3. **Order ID vs customer-facing order number** — order lookup assumes the WooCommerce
   internal order ID equals the number a customer would type. No custom order-number
   plugin is in use, so they're probably the same, but this was never explicitly
   verified against the WooCommerce admin.
4. **WooCommerce data quality** — at least one product has a blank Price and
   `Categories: Uncategorized`; one product name appears misspelled
   ("Crisply Lechong Kawali").

### D. Regression testing (recommended, not started)

Phase 3's verification checklist marked menu/hours/pricing/delivery as "✅ Working"
while bug #1 meant *no real question was ever being searched*. Those checks passed by
coincidence. There's an existing `src/scripts/test-retrieval.ts` — worth turning into a
fixed set of known questions with expected top-matching `faq_id`/`product_id`, run
after any workflow change or re-ingest.

---

## Workflow node reference (main rag-chat workflow)

```
Webhook - Chat
  → Compute Rate Limit Key → Upsert Rate Limit → Over Limit (IF)
      true  → True (over limit) → [throttle response]
      false → Classify Intent
                → Is Complaint? (IF)
                    true  → Escalation Stub → Respond to Webhook
                    false → Is Order Status? (IF)
                              true  → Have Order Info? (IF)
                                        true  → Execute Order Lookup → Format Order Response → Respond to Webhook
                                        false → Ask For Order Info → Respond to Webhook
                              false → Get Embedding → Similarity Search → Check Relevance → Relevance Check (IF)
                                        true  → Ask Claude → Format Response → Respond to Webhook
                                        false → No Match Response → Log Below-Threshold Miss → Respond to Webhook
```

**Check Relevance** (Code node) sets `THRESHOLD = 0.2` and computes
`topSimilarity` + `belowThreshold` from the top Similarity Search result.

---

## Working method notes

- Each phase starts in a **fresh conversation** using a chained handoff document (this file).
- Claude Code is used alongside chat for repo work; it **cannot** reach n8n, Supabase, or
  WordPress (those are browser/UI tasks). Anything in those systems is done by hand.
- Preference: **one step at a time** during hands-on walkthroughs, not a full list upfront.
- The n8n Postgres node's Query field can be edited by clicking directly into the text
  and using Ctrl+A; the expanded "Edit Query" modal works the same way.
- Terminal opens in `C:\Users\My PC` by default — always `cd` into the repo first or npm
  throws ENOENT on package.json.
