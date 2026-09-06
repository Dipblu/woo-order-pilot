# Order Pilot — Phase 7 Handoff

**Paste this at the start of the next conversation.** Supersedes the Phase 6 handoff and `PROJECT_NOTES.md` for anything they disagree on.

Last updated: 2026-09-06. Items 1–5, 8 DONE. Item 9 first slice DONE. Item 10 mostly covered. **One fix is designed and locally tested but NOT applied — see "START HERE" below.**

---

## 🟡 START HERE: the cancel fix is ready but not applied

Everything committed is clean and verified. `8472fdc` is the last code commit and `7525e29` added this document; repo and live n8n agree; all suites pass; the working tree is clean apart from the untracked `_pending\`. **Nothing is broken and nothing is half-applied.**

But a fix for the cancel quirk was designed, locally tested at **65/65**, and never applied. `_pending\` in the repo holds the two updated repo files; the n8n node body is embedded in this document (see "The node body" below) — there is no `.js` file in `_pending\`.

### What the fix does

`"my order was cancelled without warning"` currently routes to `faq` and never escalates — a real customer complaint goes unanswered. Two changes:

**A — narrow the cancel exclusion.** Currently `isCancelQuestion = lower.includes('cancel')`, so *any* message containing "cancel" skips the order-keyword branch. Now it also requires the word not to be past tense: past tense means it already happened (a report), present tense means they want to do it (a request).

```js
const isCancelQuestion = lower.includes('cancel') && !/\bcancell?ed\b/.test(lower);
```

**B — add six complaint keywords**, both spellings: `was cancelled`, `was canceled`, `cancelled without`, `canceled without`, `you cancelled`, `you canceled`.

`cancelled my order` was **deliberately excluded** — "I cancelled my order yesterday, when do I get confirmation?" would then escalate. It routes to `order_status` instead, which is correct.

### Verified locally (65/65)

| Message | Routes to |
|---|---|
| `how can I cancel my order?` | `faq` (unchanged) |
| `can I cancel my order` | `faq` |
| `I want to cancel my order` | `faq` |
| `what is your cancellation policy?` | `faq` |
| `cancel order 771` | `faq`, orderNumber 771 (unchanged) |
| `my order was cancelled without warning` | **`complaint`** (was `faq`) |
| `my order was canceled and nobody told me` | **`complaint`** |
| `you cancelled my order for no reason` | **`complaint`** |
| `I cancelled my order yesterday, when do I get confirmation?` | `order_status` |
| `my order was cancelled, order 771, me@x.com` | **`complaint_with_order`** |

### Apply it in this order

1. **Repo first.** Move `_pending\intent.ts` → `src\lib\intent.ts` and `_pending\test-intent.ts` → `src\scripts\test-intent.ts`. Run `npm run test:intent` — expect **65/65**.
2. **Then n8n.** Open `Classify Intent`, Ctrl+A, Delete, paste the node body from "The node body" section below. **Confirm 57 lines.** Save.
3. **Production tests**, each with a fresh sessionId against `https://dmhermoso.cloud/webhook/chat`:
   - `"my order was cancelled without warning"` → escalation confirmation + a real email to `dennisphx18@gmail.com`
   - `"how can I cancel my order?"` → faq-005 cancellation policy, NOT a lookup
   - `"what is your cancellation policy?"` → policy answer
   - `"my food arrived cold and I am very upset"` → escalation (regression check)
   - `"where is my order 771?"` → asks for the billing email (regression check)
4. **Export**, copy to `n8n\rag-chat-workflow.json`, run `npm run test:intent-sync` (expect 7/7), review `git diff --stat`, commit all three files together, push.
5. Delete `_pending\`.

**Note:** between steps 1 and 2, `npm run test:intent-sync` will FAIL on `COMPLAINT_KEYWORDS` — that is the drift guard working correctly, because `intent.ts` has the six new keywords and the n8n node does not yet. Do not "fix" it by reverting intent.ts.

### The node body

This is the authoritative copy — paste it into `Classify Intent` at step 2 (57 lines):

```javascript
const message = ($('Webhook - Chat').item.json.body?.question || '').trim();
const lower = message.toLowerCase();

const emailMatch = message.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);

// "order 771" is an order number. "can I order 20 pieces" is a quantity.
// Both match /order\s*(\d{2,8})/, so the bare form is rejected when "order"
// reads as a verb or the digits are followed by a unit. "order #20" is trusted.
const orderWordMatch = lower.match(/order\s*#?\s*(\d{2,8})/);
let orderPhraseMatch = null;
if (orderWordMatch) {
  const at = orderWordMatch.index ?? 0;
  const before = lower.slice(0, at);
  const after = lower.slice(at + orderWordMatch[0].length);
  const explicitHash = /order\s*#\s*\d/.test(orderWordMatch[0]);
  const orderIsVerb = /(?:can|could|may|should|want to|wanna|would like to|like to|to|please)\s+(?:i|we|you)?\s*$/.test(before);
  const unitFollows = /^\s*(?:of\b|pcs?\b|pieces?\b|orders?\b|servings?\b|pax\b|plates?\b|bowls?\b|packs?\b|boxes\b|sets?\b|kilos?\b|kgs?\b|grams?\b)/.test(after);
  if (explicitHash || (!orderIsVerb && !unitFollows)) orderPhraseMatch = orderWordMatch;
}

const orderNumMatch = orderPhraseMatch || message.match(/#(\d{2,8})\b/) || (emailMatch ? message.match(/\b(\d{2,8})\b/) : null);

const ORDER_KEYWORDS = ['order status', 'my order', 'track my', 'where is my', 'delivery status', 'has my order', 'status of my order'];
const COMPLAINT_KEYWORDS = ['refund', 'complaint', 'terrible', 'awful', 'worst', 'unacceptable', 'never arrived', 'missing item', 'wrong item', 'not happy', 'unhappy', 'disappointed', 'compensation', 'manager', 'escalate', 'cold food', 'arrived cold', 'very late', 'rude', 'poor service', 'bad experience', 'ridiculous', 'angry', 'upset', 'frustrated', 'damaged', 'broken', 'spoiled', 'horrible', 'did not arrive', "didn't arrive", "hasn't arrived", 'has not arrived', 'have not received', "haven't received", 'still waiting', 'not on time', 'late delivery', 'took too long', 'still not here','wrong order', 'wrong food', 'not what i ordered', 'incorrect order', 'was cancelled', 'was canceled', 'cancelled without', 'canceled without', 'you cancelled', 'you canceled'];

// --- pending state ---
const pending = $('Load Pending Intent').item.json;
const pendingIntent = pending.pending_intent || null;
const suppliedDetails = Boolean(emailMatch || orderNumMatch);
const isContinuation = Boolean(pendingIntent && suppliedDetails);

const orderNumber = (orderNumMatch ? orderNumMatch[1] : null) || (isContinuation ? pending.pending_order_number : null);
const email = (emailMatch ? emailMatch[0].toLowerCase() : null) || (isContinuation ? pending.pending_email : null);

// "how can I cancel my order?" is a request and must not hit the order-lookup
// keyword branch. "my order was cancelled" is a report about something that
// already happened, and should route normally.
const isCancelQuestion = lower.includes('cancel') && !/\bcancell?ed\b/.test(lower);
const looksLikeOrderQuery = Boolean(email && orderNumber) || (!isCancelQuestion && ORDER_KEYWORDS.some((k) => lower.includes(k)));
const looksLikeComplaint = COMPLAINT_KEYWORDS.some((k) => lower.includes(k));

let intent = 'faq';
if (isContinuation) intent = pendingIntent;
else if (looksLikeComplaint && email && orderNumber) intent = 'complaint_with_order';
else if (looksLikeComplaint) intent = 'complaint';
else if (looksLikeOrderQuery) intent = 'order_status';

return [{
  json: {
    question: isContinuation && pending.pending_question ? pending.pending_question : message,
    intent,
    orderNumber,
    email,
    isContinuation,
    sessionId: $('Webhook - Chat').item.json.body?.sessionId || null,
  },
}];
```

---

## Project snapshot

| Item | Value |
|---|---|
| Project | Order Pilot — AI support agent for a WooCommerce food delivery store |
| Live store | cociniña.com (WordPress + WooCommerce, Astra + Elementor, Hostinger) |
| Business name | Cociniña |
| n8n instance | https://dmhermoso.cloud (self-hosted, nginx 1.24 direct, no CDN) |
| Chat webhook | https://dmhermoso.cloud/webhook/chat (JSON body key is `question`, NOT `message`) |
| Order-lookup webhook | https://dmhermoso.cloud/webhook/order-lookup |
| New-order webhook | https://dmhermoso.cloud/webhook/new-order |
| Vector store | Supabase (Postgres + pgvector), ap-northeast-2 |
| Embeddings | OpenAI text-embedding-3-small (1536 dim) |
| LLM | Anthropic Claude (`claude-sonnet-5`) |
| Local repo | `C:\Users\My PC\Projects\Woo-Chatbot` |
| GitHub | Private: github.com/Dipblu/woo-order-pilot |
| Latest commit | `7525e29` (this handoff). Last code commit `8472fdc` — repo IN SYNC with live n8n |
| Telegram bot | `@cocininaalertsbot` ("Cociniña Alerts"), chat ID `8910263889` |
| Payment methods | Both COD and online gateway |

**n8n workflows (4), all Published:**
- **Order Pilot - RAG Chat** — main chat agent
- **Order Pilot - Order Lookup** — WooCommerce order lookup sub-workflow
- **Order Pilot - New Order Alert** — NEW. Webhook → Format Order Alert → Telegram
- **Order Pilot - Rate Limit Cleanup** — Schedule Trigger (daily 3am) → Postgres delete of rows older than 2 days. Uses `RETURNING 1` (no `id` column)

**Test orders:** #754 (zero-value) — leave. #769 (₱200 Chicken Curry, `hermosodennis2@gmail.com`) — the good fixture. **#771 (₱200 Lumpiang Shanghai, real COD checkout)** — billing country wrongly says **Denmark** because the checkout dropdown wasn't changed during testing; data error, not a bug. #768 half-built admin order — **trash it**, along with #771.

---

## Working method (follow these — they are hard-won)

- **Split environment.** Claude Code has the repo. n8n, Supabase, WordPress are browser-only. Never propose solutions assuming programmatic access.
- **One step at a time.** A single step, wait for the result, then the next.
- **ALWAYS provide the actual code/script to run** — never describe an action and expect translation into commands.
- **When asking to add a node, ALWAYS say where on the canvas.** Check the canvas first.
- **Make each action its own numbered step.** "Download the workflow, then run this" reads as one step and the download gets skipped.
- **Say which node connects BEFORE and AFTER.**
- **Files downloaded from chat land in `C:\Users\My PC\Downloads`, not the repo.** They must be `Move-Item`'d into place. This cost several round-trips — a test suite kept "passing" at the old count because the new file was still in Downloads. **Always verify with a line count or `Test-Path` after moving.**
- **VS Code is often in "No Folder Opened" state.** Suggest File → Open Folder on the repo. Also: the Open Folder dialog only lists directories, so it never shows a `.ts` file — that is not evidence the file is missing.
- **Terminal is PowerShell in VS Code.** `grep` does not exist — use `Select-String`. Always `cd "C:\Users\My PC\Projects\Woo-Chatbot"` first.
- **`Invoke-WebRequest` needs `-UseBasicParsing`** on this machine (Windows PowerShell 5.1).
- **Avoid multi-line PowerShell strings with backtick-escaped quotes.** A replace built that way left the terminal stuck at `>>`. For text edits in repo files, just edit in VS Code.
- **Verify in production, not the editor.** Every fix confirmed by a real request through the live webhook.
- **Executions tab, not Editor canvas.** The Executions detail panel does NOT follow the newest run — click the run by timestamp first.
- **Export = ⋯ menu → Download.** "Push to git" is paid/greyed out.
- **Do NOT edit the workflow JSON in the repo directly.** n8n is the source of truth.
- **After editing in n8n: SAVE, then DOWNLOAD, then verify the download is new** (check `LastWriteTime`).
- **Close any repo JSON open in a VS Code tab before copying an export over it.**
- **PowerShell `Set-Content -Encoding utf8` writes a BOM.** Use `[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))`, wrapped in `Join-Path (Get-Location)`.
- **`@'...'@` here-strings are LITERAL** — quote doubling does NOT collapse.
- **Escape `$json` as `` `$json` `` in git commit messages.**

### THE `=` PREFIX RULE (caused a production outage on 2026-08-22)

Exported workflow JSON stores expressions with a **leading `=`** (`"jsonBody": "={{ ... }}"`). The n8n UI expression editor does **not** want it. Pasting a repo-copied expression verbatim fails as **"The value in the JSON Body field is not valid JSON"**.

- Paste into UI expression fields **without** the `=`.
- **Always check the expression editor's Result panel before saving.** `[invalid syntax]` = broken. `[Execute previous nodes for preview]` = parses fine, that is a pass.
- Code node JS has no `=` prefix and is unaffected.
- **`Similarity Search`'s apparently-missing `=` is a CONFIRMED FALSE POSITIVE.** Do not "fix" it.

### CODE NODE EDITING RULE (caused a silent node wipe on 2026-08-22)

**Never instruct "change only line N" in a Code node.** Always supply the complete node body: select-all → delete → paste. After pasting, **confirm the modal shows the expected number of lines**. Count carefully before stating the number — a wrong count was stated twice in Phase 7 and caused false alarms. Phrase it as "should be N — tell me if it differs."

### n8n AUTO-INSERT BEHAVIOUR

Dropping a node near an existing connection makes n8n **splice it into that connection**. **Add nodes via the canvas `+` button (lands unconnected), place them in empty space, then draw connections by hand.** This worked cleanly twice in Phase 7. Screenshot and verify wiring before configuring anything.

### ONE OUTPUT DOT ≠ ONE CONNECTION

A single n8n output dot supports **multiple outgoing connections**; n8n runs all branches. This is how the Telegram alert hangs off `Rebuild Failed Answer` in parallel with `Respond to Webhook`. Different from a node's *error output*, which is a second dot created by On Error = "Continue (using error output)".

⚠️ In Phase 7, `Rebuild Failed Answer` was accidentally switched to "Continue (using error output)" during a drag, and its connection to `Respond to Webhook` went missing. **After any On Error change, verify the node's existing connections survived.** To check a node's connections on a crowded canvas, click the node once — n8n highlights its own and dims the rest.

---

## THE RECURRING BUG PATTERN

Bare `$json` in a Code/Postgres node resolves to whatever the **immediately preceding node** output — not the webhook. Insert anything upstream and it silently becomes `undefined`; the node still reports success. **Five occurrences.** Always reference the source explicitly: `$('Webhook - Chat').item.json.body.question`.

Also:
- A Postgres node returning **zero rows outputs zero items**, silently killing the branch while showing green. Write lookups with scalar subqueries or CTE + count.
- **This behaviour is now used deliberately**: `Format Order Alert` returns `[]` for a non-order payload, so the Telegram node receives zero items and does not fire.
- A Postgres `RETURNING` clause replaces the item, wiping `answer` before `Respond to Webhook`. **Five rebuild nodes exist** — `Rebuild Answer After Log`, `Rebuild No-Match Answer`, `Rebuild Escalation Answer`, `Rebuild Suppressed Answer`, `Rebuild Failed Answer`.
- **Static analysis of this workflow produces confident false positives.** Cross-check any audit finding against real execution history.
- **n8n drops `undefined` keys in `JSON.stringify`.**

---

## Current workflow structure (main rag-chat workflow)

```
Webhook - Chat
→ Compute Rate Limit Key → Upsert Rate Limit → Get Previous Window Count
→ Compute Sliding Window Estimate → Load Pending Intent → Over Limit (IF)
  true  → True (over limit) → [throttle response]
  false → Classify Intent
    → Is Complaint With Order? (IF)
      true  → Execute Order Lookup (Complaint) → Send Escalation Email (Complaint)
              → Format Combined Response → Respond to Webhook
      false → Is Complaint? (IF)
        true  → Check Recent Escalation → Already Escalated? (IF)
          true  → Escalation Suppressed → Log Suppressed Escalation
                  → Rebuild Suppressed Answer → Respond to Webhook
          false → Send Escalation Email
            (Success) → Escalation Stub → Log Escalation
                        → Rebuild Escalation Answer → Respond to Webhook
            (Error)   → Escalation Failed Response → Log Failed Escalation
                        → Rebuild Failed Answer → ┬→ Respond to Webhook
                                                  └→ Send a text message (Telegram)
        false → Is Order Status? (IF)
          true  → Have Order Info? (IF)
            true  → Execute Order Lookup → Clear Pending Intent
                    → Format Order Response → Respond to Webhook
            false → Save Pending Intent → Ask For Order Info → Respond to Webhook
          false → Get Embedding → Similarity Search → Check Relevance
                  → Relevance Check (IF)
            true  → Ask Claude → Format Response
                    → Detect Low-Confidence Answer → If (IF)
                      true  → Log Low-Confidence Answer → Rebuild Answer After Log
                              → Respond to Webhook
                      false → Rebuild Answer (Clean) → Respond to Webhook
            false → No Match Response → Log Below-Threshold Miss
                    → Rebuild No-Match Answer → Respond to Webhook
```

`Send Escalation Email` has **On Error = "Continue (using error output)"** (Success / Error). Plain "Continue" is WRONG — it routes errors down the success path and tells the customer a human was notified when none was.

**New Order Alert workflow:**
```
Webhook (POST /webhook/new-order, Respond: Immediately)
→ Format Order Alert (Code, 47 lines)
→ Send a text message (Telegram)
```

---

## Telegram alerting (NEW in Phase 7 — fully working)

Bot `@cocininaalertsbot`, display name "Cociniña Alerts". Chat ID **`8910263889`**. n8n credential named **`Telegram - Cocinina Alerts`** (ASCII deliberately — credential names appear in exported JSON and `Select-String` output).

**Bot token is NOT in the repo.** Stored locally by the user. Recover via BotFather → `/mybots` → the bot → API Token.

Two alerts live, both verified in production:

1. **Escalation email failure** — Telegram node on a parallel branch off `Rebuild Failed Answer`. Fires only when the Gmail node errors. Verified both ways: fires on failure, silent on success.
2. **New WooCommerce order** — separate workflow, fed by a WooCommerce webhook. Verified with real order #771.

### Telegram gotchas

- **`getUpdates` returns `{"ok":true,"result":[]}` even with `pending_update_count: 1`** once an earlier call has advanced the offset. Use **`getUpdates?offset=-1`** to retrieve the held update. Go straight to `offset=-1`.
- **Telegram's in-app search may not find `@BotFather` on a fresh account.** Use `https://t.me/BotFather` — and open it *inside Telegram*, not via a Facebook/Messenger in-app browser, which wraps the URL in `l.facebook.com` and fails to hand off.
- **Bot usernames are ASCII-only** and must end in `bot`. The ñ is fine in the *display name*.
- **"Append n8n Attribution" is ON by default** and adds an italic footer. In the Telegram node it lives **below Additional Fields**, easy to miss below the fold. Toggle it off. Already-sent messages keep the footer.
- Executing a Telegram node in isolation with no input item does nothing and reports "No output data" — not an error, just no items to iterate.
- Do not set a parse mode. Plain text avoids breakage on customer messages containing `_` or `*`.

### WooCommerce webhook config

WooCommerce → Settings → Advanced → Webhooks:
- Name `Order Pilot - New Order Alert`, Status **Active**, Topic **Order created**
- Delivery URL `https://dmhermoso.cloud/webhook/new-order`
- Secret auto-generated (n8n does NOT verify it — see open items)
- API Version **WP REST API Integration v3**

**WooCommerce sends a ping payload on webhook create/update.** This produced a `NEW ORDER #unknown` alert with empty fields. `Format Order Alert` now guards with `if (!order.id && !order.number) return [];`.

**`order.created` was chosen over `order.updated`** deliberately. With an online gateway, `order.created` can fire while status is still `pending` — the alert prints `Status:` so you can tell. There is **no second alert when payment clears.** If pending-then-paid orders prove common, add a second webhook on `order.updated` with a status filter.

The alert deliberately shows the **full unmasked address** (you need it to deliver) and **omits the country/state field**, sidestepping the `00` state-code issue. Prefers `shipping` over `billing` when shipping has a street.

---

## Intent classification test suite (item 9 first slice)

**No test runner was added.** Follows the existing `test-retrieval.ts` house style: a flat `TEST_CASES` array, `X/Y passed`, a FAILURES block, `process.exit(1)`. Rationale: `"type": "module"` + no config + no new deps.

**Files:**
- `src/lib/intent.ts` — pure `classifyIntent(message, pending)`, no n8n globals. Exports `ORDER_KEYWORDS`, `COMPLAINT_KEYWORDS`.
- `src/scripts/test-intent.ts` — **57 cases committed** (65 once the cancel fix lands).
- `src/scripts/test-intent-sync.ts` — **7 checks**, drift guard.

**npm scripts:** `test:intent`, `test:intent-sync`. Both run in under a second with no live services — run them before every commit.

### The drift problem and how it is handled

n8n Code nodes cannot import from the repo, so `intent.ts` is necessarily a **second copy**. A generator that rewrites the n8n node from `intent.ts` was **considered and rejected** — it would mean replacing the most failure-prone node in the workflow with no verification path other than production traffic.

Instead `test-intent-sync.ts` reads `n8n/rag-chat-workflow.json`, extracts `Classify Intent`'s `jsCode`, and asserts: both keyword lists match exactly, all four extraction regexes are present, the cancel exclusion is present, the continuation branch is present and ordered first, and the `$('Webhook - Chat')` question reference is intact.

**Limitation, stated plainly:** it does not prove the whole node is identical. It did NOT detect the quantity fix, because the guard checks that `/order\s*#?\s*(\d{2,8})/` is *present* and the fix wraps that regex rather than replacing it. It DOES detect keyword-list changes. **n8n remains the source of truth for behaviour.**

### Known behaviours recorded as test cases (not bugs to "fix" blindly)

- **QUIRK — continuation outranks a fresh complaint.** With a pending intent, `"order 771 me@x.com and the food was terrible"` routes to order lookup, not escalation. Untested in production; probably not intended.
- **GAP — no staleness concept.** A pending intent from three days ago continues as readily as one from thirty seconds ago, and replaces the customer's current question with the stored one. Missing functionality in `pending_intents`, not a test problem. Item 10's third bullet.
- **GAP — `"where is order 771"` routes to `faq`.** `ORDER_KEYWORDS` contains `'where is my'`, not `'where is'`, and without an email `looksLikeOrderQuery` is false. The order number IS extracted; the routing just misses. Natural phrasing, real miss. Likely a one-keyword fix, but check it doesn't collide with the cancel exclusion.

### Fixed in Phase 7

- **Quantity read as order number** (`8472fdc`). `"can I order 20 pieces of lumpia?"` extracted `20` and, with a pending intent, attempted a lookup for someone else's order. Now rejects the bare form when `order` reads as a verb or a unit follows. `order #20` still trusted. Trade-offs accepted: bare `order 20` with no cue is still an order number; `can I order 771` is now rejected (overwhelmingly a purchase phrasing, and the customer gets re-prompted).
- **Cancellation complaints** — designed and tested, NOT yet applied. See START HERE.

---

## QA LIST

### ✅ 1. Late-order routing — DONE (`1cc783b`)
### ✅ 2. `isLowConfidence` leaked to the browser — DONE (`2a63e31`)
### ✅ 3. `Get Embedding` vs `Classify Intent` continuation mismatch — DONE (`a15f327`)
### ✅ 4. faq-014 placeholder recommendations — DONE (`3e40d08`, `d502a3c`)

Real sales data will fix *which dishes* get named. It will NOT fix embellishment — the prompt constraint is the durable half. The `Ask Claude` system string must use **backticks** inside the expression (it contains apostrophes). faq-013's question text is deliberately broadened; `test:retrieval` depends on it.

### ✅ 5. Harden remaining bare `$json` refs — DONE (`4facc9b`)

**Do not touch:** `Compute Rate Limit Key` (M3), `Normalize Input` in order-lookup (H3). **Left bare deliberately:** the `...$json` spread in `Detect Low-Confidence Answer`.

### 6. Order ID vs customer-facing order number — VERIFIED ×3, note still unwritten
#754, #769, and now **#771 (a real COD checkout order)** all display as their API `number`. No custom order-number plugin. Pure documentation task.

### 7. `unanswered_questions` / `escalations` have no review cadence
Tables fill but nothing reads them on a schedule. **A Telegram channel now exists** — a scheduled digest is newly cheap to build.

### ✅ 8. Escalation email dedup + failure handling — FULLY DONE (`2daeddf`, `fcdc07c`, `c22bb2f`, `7c8e9c1`, `1734464`)
Dedup: 10-minute window, `suppressed` flag. Failure: honest message + `email_status = 'failed'`. Telegram failure alert added and verified.

10 minutes was chosen over 30 deliberately: being blind to a genuinely new complaint is worse than a few extra emails.

⚠️ The failure test requires temporarily setting the Gmail To field to `not-a-valid-address`. **The correct value is `dennisphx18@gmail.com`** — write it down before breaking it, restore it after, re-run a success test, and grep the export for both the correct value and the broken one before committing.

### 9. Regression coverage — FIRST SLICE DONE
Intent classification: 57 cases + 7-check drift guard. **Still uncovered:** order lookup, escalation, rate limiting. Those aren't pure functions — they need a live webhook or a database, so they need a different approach (fixtures, or hitting the production webhook and asserting on the response). That is its own design conversation.

### 10. Session-state branches — MOSTLY COVERED
Partial replies (both orders), unrelated follow-ups, pending complaint/`complaint_with_order` intents: all covered by tests. **Stale pending intents remain untested and unimplemented** — there is no staleness logic to test.

### 11. Sliding-window edge cases untested
Window boundary behaviour, and `Get Previous Window Count` returning null vs 0. Postgres-dependent, not reachable from the intent suite.

### 12. No load/concurrency testing
`ON CONFLICT DO UPDATE` under real concurrent upserts is assumed correct, not verified.

---

## Unnumbered candidate items

1. ✅ `Total: PHP 0.00` — RESOLVED, was #754's data.
2. ✅ Full delivery street address masked in customer-facing order lookup (`•••`). **Note:** the new-order Telegram alert deliberately shows the FULL address — different audience, different rule.
3. **`widget\RATE_LIMITING.md` is STALE** (Aug 9) — documents the old fixed-window design.
4. **`PROJECT_NOTES.md` is STALE** — ends at Phase 4.
5. **Widget-side markdown stripping** — prompt fix works but isn't a guarantee. Do **not** switch to `innerHTML`.
6. **`Detect Low-Confidence Answer` may under-match.** Real declines going unlogged.
7. **`00` appears in customer-facing addresses** (WooCommerce state code for Metro Manila). Fix in `Verify & Build Response`. Sidestepped in the Telegram alert by omitting state entirely.
8. **Escalation email address hardcoded in FOUR places** — `GENERIC_FAIL`, `Escalation Stub`, `Escalation Failed Response`, and the no-match response all name `dennisphx18@gmail.com`, plus two `sendTo` fields (lines ~581 and ~775). Change together.
9. **Gmail escalation body renders a raw ISO timestamp in a US Eastern offset** (`2026-09-04T07:04:29.394-04:00`). The Telegram nodes format properly with `{{ $now.setZone('Asia/Manila').toFormat('yyyy-LL-dd HH:mm') }}`. One-line fix.
10. **The new-order webhook has no signature verification.** WooCommerce generated a secret; n8n ignores it. Anyone who learns the URL can push a fake order alert. Low stakes (a bogus Telegram message, no data exposure) but trivially fixable with an HMAC check node.

---

## Site operations (not Order Pilot, but blocking)

**WordPress email is fixed.** WP Mail SMTP → Other SMTP → `smtp.hostinger.com`, port **465**, **SSL**, auth on, Force From Email + Force From Name on. Mailbox `dennishermoso@cociniña.com`. MX, SPF, DKIM, DMARC all green. Verified end to end.

### ⚠️ THE PUNYCODE RULE

**Anywhere an email address on this domain is stored or validated, use the punycode form:**

```
dennishermoso@xn--cocinia-9za.com
```

The ñ form **fails silently** in both places tried: WP Mail SMTP username → `535 5.7.8 authentication failed`; WooCommerce email recipients → saves as empty, no error. Hostinger's UI displays the ñ version, which is misleading. Correct punycode is `xn--cocinia-9za.com` (NOT `xn--cocinia-o1a.com`). The ñ form IS fine as a plain To: display address once saved.

### ⚠️ Intermittent WordPress admin CSS failure — UNRESOLVED

WP admin periodically renders as **unstyled HTML** (menu tree as plain links). Purging fixes it for a few minutes, then it returns. Almost certainly LiteSpeed Cache CSS/JS combine-minify regenerating broken output.

**Not diagnosed.** Next step is F12 → Console + Network while broken, checking whether CSS requests 404, return the wrong MIME type, or are blocked. Pragmatic alternative: turn off LiteSpeed's CSS/JS optimization (Page Optimization → CSS/JS Settings) and see if it stops.

This blocked webhook configuration mid-session. It will keep biting.

---

## Export and commit (use this exact snippet)

```powershell
cd "C:\Users\My PC\Projects\Woo-Chatbot"
$latest = Get-ChildItem "$env:USERPROFILE\Downloads\Order Pilot - RAG Chat*.json" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$latest.Name
$latest.LastWriteTime   # CONFIRM this is minutes old
Copy-Item $latest.FullName "n8n\rag-chat-workflow.json" -Force
Select-String -Path "n8n\rag-chat-workflow.json" -Pattern "<something unique to the change>" -SimpleMatch
```

Other workflows: `Order Pilot - Order Lookup*.json` → `n8n\order-lookup-workflow.json`; `Order Pilot - New Order Alert*.json` → `n8n\new-order-alert-workflow.json`.

Only commit once `Select-String` proves the change is in the file. Review `git diff --stat` first — a node addition should be nearly all insertions; unexplained deletions warrant `git diff -U1 | Select-String "^-"`. A `jsCode` change shows as only a few lines because the whole node body is one JSON string.

---

## Reference — data state

**Supabase `documents`:** 14 rows `metadata.source='faq'` (faq-001…faq-014), 9 rows `metadata.source='product'`.
- FAQ identifier: `metadata.faq_id`. Product identifier: `metadata.name`.
- **`source` is NOT a column** — query as `metadata->>'source'`

**Supabase tables:** `documents`, `rate_limits`, `unanswered_questions`, `pending_intents`, `escalations`.

**`rate_limits` columns:** `identifier`, `window_start`, `request_count`. No `id` column.

**`escalations` columns:** `session_id`, `reason`, `question`, `suppressed` (bool, default false), `email_status` (text, default `'sent'`), `created_at`. **No `id` column** — use `returning 1 as logged`.

**Migrations:** `migrations\001_rate_limits.sql`, `002_escalations.sql`, `003_escalation_email_status.sql`.

**The 9 dishes:** Ginataang Hipon, Tofu Sisig, Pork Adobo, Lumpiang Shanghai, Special Chicken Adobo, Crispy Lechon Kawali, Sizzling Sisig, Chicken Curry, Sweet and Spicy Laing.

**`src/data/faqs.json`** is the only local data file. Products fetched live from WooCommerce during ingest. CRLF after PowerShell round-trips — harmless, noisy diffs.

**npm scripts:** `test:connection`, `ingest:faqs`, `ingest:products`, `test:retrieval` (26 cases, `MATCH_WITHIN = 3`, 26/26 passing), `test:intent` (57 cases), `test:intent-sync` (7 checks).

**Editing WooCommerce products changes nothing until `npm run ingest:products` is re-run.** Same for `faqs.json` and `ingest:faqs`.

**User's IP rotates between sessions.** `select * from rate_limits order by window_start desc limit 5;`

**Repo docs:** `PROJECT_NOTES.md`, `ORDER_PILOT_HANDOFF_PHASE4.md`, `README.md`, `widget\RATE_LIMITING.md`, `widget\WIDGET_README.md`.

---

## Commit log

### Phase 6
`1cc783b` item 1 · `2a63e31` item 2 · `a15f327` item 3 · `3e40d08` + `d502a3c` item 4 · `4facc9b` item 5 · `eeeec34` handoff · `2daeddf` + `fcdc07c` + `c22bb2f` + `7c8e9c1` item 8

### Phase 7
| Commit | Item |
|---|---|
| `1734464` | item 8 — Telegram alert on escalation email failure |
| `a9297a7` | new workflow — Telegram alert on new WooCommerce order |
| `f3d50dc` | new-order alert — ignore payloads with no order id |
| `f05e9f1` | item 9 — intent classification regression suite (31 cases + sync guard) |
| `8ede60f` | item 10 — session-state cases (→ 47 cases) |
| `8472fdc` | fix — quantity after "order" no longer read as an order number (→ 57 cases) |
| `7525e29` | docs — this handoff |

---

## Suggested next steps

1. **Apply the cancel fix** — see START HERE at the top. Designed, tested at 65/65, needs applying and verifying.
2. **Fix the `"where is order N"` routing gap** — likely a one-keyword change, but verify it doesn't collide with the cancel exclusion.
3. **Docs pass** — item 6's note, candidates 3 and 4, the punycode rule, the SMTP settings, and the Phase 7 approach to n8n testing. All of this currently lives only in chat history, which is exactly how the punycode rule cost time twice.
4. **Scheduled digest of `unanswered_questions` + `escalations` to Telegram** (item 7) — newly cheap now that the bot exists.
5. **Small cleanups** — trash orders #768 and #771, fix the `00` state code, consolidate the four hardcoded email addresses, Manila-format the Gmail timestamp, check the WooCommerce default checkout country.
6. **Extend item 9 to non-pure components** — order lookup, escalation, rate limiting. Needs a design conversation about fixtures vs live-webhook assertions.
7. **Diagnose the LiteSpeed admin CSS problem** — site-ops, but it will keep interrupting.
