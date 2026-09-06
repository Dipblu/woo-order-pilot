# Order Pilot — Phase 6 Handoff (QA Remediation, In Progress)

> **SUPERSEDED — historical record only.**
> This handoff describes the state of the project during Phase 6. It is kept for
> history; do not follow it as current guidance. For the current state see
> `ORDER_PILOT_HANDOFF_PHASE7.md` and the docs under `docs/`.
>
> This file was committed empty by `eeeec34` and recovered from `760d3ef` on
> 2026-09-06. Its punctuation was also mangled by a console-code-page round-trip
> (64 characters) and has been repaired.

**Paste this at the start of the next conversation.** This supersedes the Phase 5 handoff and context primer for anything they disagree on.

---

## Project snapshot

| Item | Value |
|---|---|
| Project | Order Pilot — AI support agent for a WooCommerce food delivery store |
| Live store | cocini├▒a.com (WordPress + WooCommerce, Astra + Elementor) |
| Business name | Cocini├▒a |
| n8n instance | https://dmhermoso.cloud (self-hosted, nginx 1.24 direct, no CDN) |
| Chat webhook | https://dmhermoso.cloud/webhook/chat (JSON body key is `question`, NOT `message`) |
| Order-lookup webhook | https://dmhermoso.cloud/webhook/order-lookup |
| Vector store | Supabase (Postgres + pgvector), ap-northeast-2 |
| Embeddings | OpenAI text-embedding-3-small (1536 dim) |
| LLM | Anthropic Claude (`claude-sonnet-5`) |
| Local repo | `C:\Users\My PC\Projects\Woo-Chatbot` |
| GitHub | Private: github.com/Dipblu/woo-order-pilot |
| Latest commit | `1cc783b` — repo is IN SYNC with live n8n as of this handoff |
| Test order | WooCommerce #754 (zero-value, "processing") — leave in place |

---

## Working method (follow these — they are hard-won)

- **Split environment.** Claude Code has the repo. n8n, Supabase, WordPress are browser-only and unreachable by any tool. Never propose solutions assuming programmatic access to them.
- **One step at a time.** Give a single step, wait for the result, then the next. Do not dump numbered lists of eight things.
- **ALWAYS provide the actual code/script to run** — never describe an action and expect the user to translate it into commands. This was an explicit request.
- **When asking the user to add a node, ALWAYS say where on the canvas to place it.** Also explicit.
- **Terminal is PowerShell in VS Code.** `grep` does not exist — use `Select-String`. Always `cd "C:\Users\My PC\Projects\Woo-Chatbot"` first.
- **Verify in production, not the editor.** Every fix is confirmed by a real request through the live webhook + checking the resulting execution.
- **Executions tab, not Editor canvas.** Clicking a node on the Editor shows cached state and often "No output data". Historical runs must be opened from **Executions**, then the node clicked *inside that run*.
- **Export = ⚠ menu → Download.** No "Export" item. "Push to git" is paid/greyed out.
- **Be explicit whether an edit changes a line or replaces a file.** A Code node was once wiped by an ambiguous instruction.
- **PowerShell `Set-Content -Encoding utf8` writes a BOM and breaks JSON parsers.** Use `[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))`.
- **Do NOT edit the workflow JSON in the repo directly.** A PowerShell edit to `Classify Intent` was silently lost when a later n8n download overwrote the file. n8n is the source of truth; make changes there, then export.

---

## THE RECURRING BUG PATTERN

Bare `$json` in a Code/Postgres node resolves to whatever the **immediately preceding node** output — not the webhook. Insert anything upstream and it silently becomes `undefined`; the node still reports success. **Five occurrences so far.** Always reference the source explicitly: `$('Webhook - Chat').item.json.body.question`.

Also:
- A Postgres node returning **zero rows outputs zero items**, silently killing the branch while showing green. Write lookups with scalar subqueries or CTE + count so they always return exactly one row.
- A Postgres `RETURNING` clause replaces the item, wiping `answer` before `Respond to Webhook`. Fix with a small rebuild Code node after the log write.
- **Static analysis of this workflow produces confident false positives.** Cross-check any audit finding against real execution history before acting.

---

## Current workflow structure (main rag-chat workflow)

Webhook - Chat
→ Compute Rate Limit Key → Upsert Rate Limit → Get Previous Window Count
→ Compute Sliding Window Estimate → Load Pending Intent → Over Limit (IF)
true → True (over limit) → [throttle response]
false → Classify Intent
→ Is Complaint With Order? (IF) [NEW this phase]
true → Execute Order Lookup (Complaint)
→ Send Escalation Email (Complaint)
→ Format Combined Response → Respond to Webhook
false → Is Complaint? (IF)
true → Send Escalation Email → Escalation Stub → Respond to Webhook
false → Is Order Status? (IF)
true → Have Order Info? (IF)
true → Execute Order Lookup → Clear Pending Intent
→ Format Order Response → Respond to Webhook
false → Save Pending Intent → Ask For Order Info
→ Respond to Webhook
false → Get Embedding → Similarity Search → Check Relevance
→ Relevance Check (IF)
true → Ask Claude → Format Response
→ Detect Low-Confidence Answer → If (IF)
true → Log Low-Confidence Answer
→ Rebuild Answer After Log
→ Respond to Webhook
false → Respond to Webhook ← LEAK, see Item 2
false → No Match Response → Log Below-Threshold Miss
→ Rebuild No-Match Answer → Respond to Webhook


Separate workflow: **Order Pilot - Rate Limit Cleanup** — Schedule Trigger (daily 3am) → Postgres delete of rows older than 2 days. Uses `RETURNING 1` (table has no `id` column). Must be Published to fire.

---

## COMPLETED in the previous session (do not redo)

1. **`Classify Intent` keyword edits** — added `wrong order`, `wrong food`, `not what i ordered`, `incorrect order`; removed `cancel my order` (was escalating routine policy questions and sending real emails).
2. **`isCancelQuestion` fix** — removing `cancel my order` exposed that `ORDER_KEYWORDS` contains `'my order'`, so "how can I cancel my order?" got hijacked into order lookup. Fixed by excluding cancel-questions from the keyword branch of `looksLikeOrderQuery`. Verified: now answers from the cancellation-policy FAQ.
3. **Rate-limit burst test** — finally verified end-to-end. Widget testing was inconclusive because human pacing straddles window boundaries; used a PowerShell loop hitting the webhook directly instead. Throttle fired on request 21.
4. **Sliding-window rate limiter (NEW)** — user correctly identified that fixed 10-min windows never catch a slower-but-excessive pattern (e.g. 15 + 15 across two windows). Built: `previousWindowStart` added to `Compute Rate Limit Key`; new Postgres node `Get Previous Window Count`; new Code node `Compute Sliding Window Estimate` (blends current + previous weighted by elapsed fraction); `Over Limit` now compares `estimatedCount > 20`. **Verified** via a timed two-window boundary test — `Over Limit` fired true in the second window before it alone reached 20.
5. **B3 (`Similarity Search` missing leading `=`)** — CONFIRMED FALSE POSITIVE. The query has valid `{{ }}` expressions and RAG has worked in production throughout. No action needed. Do not revisit.
6. **Review-spam WordPress settings** — Settings → Discussion: hold comments with **0** or more links; Disallowed Comment Keys populated with `casino, slot, apk, RTP, bankroll, jili, payout` + IPs `14.199.128.233, 61.186.20.52, 61.186.24.252`. (Verified-owners-only reviews and marking existing spam as Spam were done earlier.)
7. **`ingest-products.ts` review-data check** — `Select-String` for "review" returned **no matches**. Review spam never entered the vector store. Closed.
8. **Item D — regression test harness** — `src/scripts/test-retrieval.ts` rewritten from a single-question printer into a 26-case suite with pass/fail and `process.exit(1)` on failure. Run with `npm run test:retrieval`. Uses `MATCH_WITHIN = 3` (expected result must appear in top 3). **Caught a real gap on first run**: "what do you have available to eat" ranked faq-013 at #4. Fixed by broadening faq-013's question text to `"What's on the menu? What food do you have available? What can I order?"`, re-ran `npm run ingest:faqs`, now **26/26 passing**.

---

## QA LIST — 12 items, working through in order

Item #1 is DONE. Item #2 is IN PROGRESS. Items #3–12 not started.

### ✅ 1. Late-order routing — DONE AND VERIFIED
"My order is late" used to escalate without ever returning order status. Fixed by adding a `complaint_with_order` intent (only when the message supplies BOTH email and order number) and a fully **duplicated** branch (deliberately not reusing existing nodes, to avoid disturbing verified paths):

`Classify Intent → Is Complaint With Order? (IF, $json.intent == "complaint_with_order")`
- true → `Execute Order Lookup (Complaint)` → `Send Escalation Email (Complaint)` → `Format Combined Response` → `Respond to Webhook`
- false → `Is Complaint?` (existing chain untouched)

`Classify Intent` intent block now reads:
```js
let intent = 'faq';
if (isContinuation) intent = pendingIntent;
else if (looksLikeComplaint && email && orderNumber) intent = 'complaint_with_order';
else if (looksLikeComplaint) intent = 'complaint';
else if (looksLikeOrderQuery) intent = 'order_status';
```

`Format Combined Response`:
```js
const orderInfo = $('Execute Order Lookup (Complaint)').item.json.message;
return [{ json: { answer: `I'm sorry you're having trouble with your order — I've flagged this for a team member to follow up with you by email.\n\nIn the meantime, here's your current order status:\n\n${orderInfo}` } }];
```

**All three routing cases verified in production:** complaint+order → combined reply; complaint alone → escalation only; order status alone → status only. Committed as `1cc783b`.

### ≡ƒöä 2. `isLowConfidence` leaks to the browser — IN PROGRESS, NEXT STEP BELOW
`Detect Low-Confidence Answer` returns `{ ...$json, isLowConfidence }`. On the `If` node's **true** branch this is harmless (`Rebuild Answer After Log` strips it). On the **false** branch it goes straight to `Respond to Webhook`, so the internal flag ships to the client.

**Chosen approach (Option A — additive, mirrors an existing proven pattern):** add a rebuild node on the false branch. Do NOT narrow the `...$json` spread in `Detect Low-Confidence Answer` — downstream logging depends on those fields.

**EXACT NEXT STEP:**
Create a new **Code** node named exactly `Rebuild Answer (Clean)`, placed between the `If` node and `Respond to Webhook` (position it just right of `If`, in open space below `Rebuild Answer After Log`). Code:
```js
return [{ json: { answer: $('Format Response').item.json.answer } }];
```
Then wire `If` (**false**) → `Rebuild Answer (Clean)` → `Respond to Webhook`, removing the direct `If`→`Respond to Webhook` false connection. Then test in production with a question that produces a normal (non-declining) answer and confirm the response JSON contains ONLY `answer`.

### 3. `Get Embedding` vs `Classify Intent` disagree on continuations
`Get Embedding` always embeds the raw latest message; `Classify Intent` may substitute stored `pending_question`. Rare today (continuations imply order_status, skipping the embedding path) but a latent inconsistency never deliberately resolved.

### 4. faq-014 recommendations are placeholder data
Dishes named are not real best-sellers, worded as suggestions. Update in `src/data/faqs.json` + re-run `npm run ingest:faqs` once real order data exists. Consider adding an inline note so a future editor doesn't restate them as fact.

### 5. Harden remaining bare `$json` refs (audit items M1–M4)
Currently resolve correctly *by coincidence of node order*. Three of five major bugs came from exactly this. Note: **M3** (`Compute Rate Limit Key` line with `...$json` spread) was explicitly assessed as harmless — `rateLimitIp`/`windowStart` on that line are load-bearing; **don't touch it**. **H3** (`Normalize Input` in the order-lookup workflow) is justified and must stay — it discriminates between two triggers.

### 6. Order ID vs customer-facing order number
Verified only for #754. Breaks silently if a custom order-number plugin is ever installed or numbering changes. Add a safeguard or at minimum a documented note.

### 7. `unanswered_questions` has no review cadence
Table is filling with real misses but nothing reads it on a schedule.

### 8. Escalation email has no delivery confirmation or retry
If the Gmail node fails (auth expiry, API error), the customer is still told a human was notified. No monitoring. **Also newly noted:** there is no dedup — five angry messages send five emails. Consider suppressing repeat escalations per session within a time window.

### 9. Regression coverage is retrieval-only
`test-retrieval.ts` validates embedding search but nothing else. Intent classification, order lookup, escalation, and rate limiting have no automated coverage — a `Classify Intent` regression would not be caught.

### 10. Session-state branches untested
Verified only the happy path. Untested: partial replies (order number now, email later), an unrelated follow-up that should NOT be treated as a continuation, and stale pending intents (customer abandons, returns days later).

### 11. Sliding-window edge cases untested
Verified for one real scenario. Untested in isolation: behavior exactly at a window boundary, and `Get Previous Window Count` returning null vs 0 (COALESCE should handle it, but unproven).

### 12. No load/concurrency testing
Single identifier only. `ON CONFLICT DO UPDATE` under real concurrent upserts is assumed correct, not verified.

---

## Also worth noting

**`widget\RATE_LIMITING.md` is now STALE** (dated Aug 9). It documents the old fixed-window design and no longer matches production after the sliding-window change. Update it or add it to the QA list.

---

## Reference — data state

**Supabase `documents`:** 14 rows `metadata.source='faq'` (faq-001…faq-014), 9 rows `metadata.source='product'`.
- FAQ rows: identifier is `metadata.faq_id` (e.g. `"faq-001"`)
- Product rows: identifier is `metadata.name` (e.g. `"Ginataang Hipon"`)
- **Note:** `source` is NOT a column — query it as `metadata->>'source'`

**`rate_limits` columns:** `identifier`, `window_start`, `request_count`. No `id` column.

**Supabase tables:** `documents`, `rate_limits`, `unanswered_questions`, `pending_intents`.

**The 9 dishes:** Ginataang Hipon, Tofu Sisig, Pork Adobo, Lumpiang Shanghai, Special Chicken Adobo, Crispy Lechon Kawali, Sizzling Sisig, Chicken Curry, Sweet and Spicy Laing.

**`src/data/faqs.json`** is the only local data file. Products are fetched live from WooCommerce during ingest — no static file.

**npm scripts:** `test:connection`, `ingest:faqs`, `ingest:products`, `test:retrieval` (all via `tsx`).

**Editing WooCommerce products changes nothing for the chatbot until `npm run ingest:products` is re-run.**

**The user's IP rotates between sessions** (seen: 112.206.2.150, 112.206.0.145, 161.49.96.141, 112.206.0.179). When querying `rate_limits`, get the current IP from a recent execution's `Compute Rate Limit Key` input, or just `select * from rate_limits order by window_start desc limit 5;`.

**Repo docs:** `PROJECT_NOTES.md`, `ORDER_PILOT_HANDOFF_PHASE4.md`, `README.md`, `widget\RATE_LIMITING.md`, `widget\WIDGET_README.md`.

---

## Open question

The user was originally told this project would run through **Phase 6**, but no record of Phase 6's intended scope exists in any handoff. `PROJECT_NOTES.md` may contain the original phase breakdown — check it. The 12-item QA list above is currently serving as the de facto Phase 6.
