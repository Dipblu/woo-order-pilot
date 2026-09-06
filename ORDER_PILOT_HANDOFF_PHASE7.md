# Order Pilot — Phase 7 Handoff

**Paste this at the start of the next conversation.**

Last updated: 2026-09-06.

---

## Read these first

The durable knowledge that used to live in this handoff now has a permanent home.
**This file only carries status** — what is done, what is open, what to do next.
Anything that describes how the systems work lives in `docs/`:

| File | Covers |
|---|---|
| `docs/OPERATIONS.md` | punycode rule, SMTP, Telegram, WooCommerce webhook, LiteSpeed issue, encoding hazards, test orders |
| `docs/N8N_NOTES.md` | working method, `=` prefix rule, code-node rule, canvas behaviour, the `$json` bug pattern, export/commit procedure, workflow structure, Supabase schema |
| `docs/TESTING.md` | the suites, the drift guard and its limits, known-behaviour cases, coverage gaps |

If something in `docs/` turns out to be wrong, **fix it there** rather than
recording the correction here. That is the whole point of the split — this file
is rewritten every phase, those are not.

Older handoffs (`ORDER_PILOT_HANDOFF_PHASE4.md`,
`docs/order-pilot-phase6-handoff.md`) and `PROJECT_NOTES.md` are historical
records only. Do not follow them as current guidance.

---

## Where things stand

**Nothing is half-applied. The repo, live n8n and GitHub all agree.** Working
tree is clean, all suites pass.

| | |
|---|---|
| Latest commit | `f7181db` |
| Last code commit | `48c0def` |
| `npm run test:intent` | 69/69 |
| `npm run test:intent-sync` | 7/7 |
| `npm run test:retrieval` | 26/26 |

### Done in this session (2026-09-06)

- **`69025dc`** — cancellation complaints now escalate instead of routing to
  `faq`. Narrowed the cancel exclusion so past-tense "cancelled" is treated as a
  report rather than a request, and added six complaint keywords. Verified 5/5 in
  production, both escalation emails received.
- **`48c0def`** — `"where is order N"` without the possessive now routes to
  `order_status`. Added `'where is order'` to `ORDER_KEYWORDS`. Verified 5/5 in
  production, including that `"where is your store located?"` still routes to
  `faq`.
- **`2b2f31f`** — recovered `docs/order-pilot-phase6-handoff.md`, which had been
  committed as a 0-byte file by `eeeec34`, replacing 15KB of content. Repaired 64
  mangled characters and marked it superseded.
- **`f7181db`** — added `docs/OPERATIONS.md`, `docs/N8N_NOTES.md`,
  `docs/TESTING.md`.

---

## Project snapshot

| Item | Value |
|---|---|
| Project | Order Pilot — AI support agent for a WooCommerce food delivery store |
| Live store | cociniña.com (WordPress + WooCommerce, Astra + Elementor, Hostinger) |
| Business name | Cociniña |
| Local repo | `C:\Users\My PC\Projects\Woo-Chatbot` |
| GitHub | Private: github.com/Dipblu/woo-order-pilot |
| Payment methods | Both COD and online gateway |

Endpoints, credentials and schema: see `docs/N8N_NOTES.md`.
Site operations and alerting: see `docs/OPERATIONS.md`.

---

## QA LIST

### ✅ 1. Late-order routing — DONE (`1cc783b`)
### ✅ 2. `isLowConfidence` leaked to the browser — DONE (`2a63e31`)
### ✅ 3. `Get Embedding` vs `Classify Intent` continuation mismatch — DONE (`a15f327`)
### ✅ 4. faq-014 placeholder recommendations — DONE (`3e40d08`, `d502a3c`)

Real sales data will fix *which dishes* get named. It will NOT fix embellishment
— the prompt constraint is the durable half. The `Ask Claude` system string must
use **backticks** inside the expression (it contains apostrophes). faq-013's
question text is deliberately broadened; `test:retrieval` depends on it.

### ✅ 5. Harden remaining bare `$json` refs — DONE (`4facc9b`)

### 6. Order ID vs customer-facing order number — DOCUMENTED
Now written up in `docs/OPERATIONS.md`. Verified across #754, #769 and #771: all
display as their API `number`, no custom order-number plugin installed.

### 7. `unanswered_questions` / `escalations` have no review cadence
Tables fill but nothing reads them on a schedule. **A Telegram channel now
exists** — a scheduled digest is cheap to build.

### ✅ 8. Escalation email dedup + failure handling — FULLY DONE (`2daeddf`, `fcdc07c`, `c22bb2f`, `7c8e9c1`, `1734464`)

Dedup: 10-minute window, `suppressed` flag. Failure: honest message +
`email_status = 'failed'`. Telegram failure alert added and verified.

10 minutes was chosen over 30 deliberately: being blind to a genuinely new
complaint is worse than a few extra emails.

### 9. Regression coverage — FIRST SLICE DONE, EXTENDED
Intent classification now at 69 cases + 7-check drift guard. **Still uncovered:**
order lookup, escalation, rate limiting. Those aren't pure functions — they need
a live webhook or a database, so they need a different approach. See the coverage
section in `docs/TESTING.md`. That is its own design conversation.

### 10. Session-state branches — MOSTLY COVERED
**Stale pending intents remain untested and unimplemented** — there is no
staleness logic to test.

### 11. Sliding-window edge cases untested
Window boundary behaviour, and `Get Previous Window Count` returning null vs 0.
Postgres-dependent, not reachable from the intent suite.

### 12. No load/concurrency testing
`ON CONFLICT DO UPDATE` under real concurrent upserts is assumed correct, not
verified.

---

## Unnumbered candidate items

1. ✅ `Total: PHP 0.00` — RESOLVED, was #754's data.
2. ✅ Full delivery street address masked in customer-facing order lookup.
3. **`widget\RATE_LIMITING.md` is STALE** (Aug 9) — documents the old
   fixed-window design.
4. **`PROJECT_NOTES.md` is STALE** — ends at Phase 4. 378 lines of flat prose,
   no headings. Left intact deliberately; may hold Phase 1–4 setup detail that
   exists nowhere else.
5. **Widget-side markdown stripping** — prompt fix works but isn't a guarantee.
   Do **not** switch to `innerHTML`.
6. **`Detect Low-Confidence Answer` may under-match.** Real declines going
   unlogged.
7. **`00` appears in customer-facing addresses.** Fix in
   `Verify & Build Response`. See `docs/OPERATIONS.md`.
8. **Escalation email address hardcoded in FOUR places.** Change together — see
   `docs/OPERATIONS.md`.
9. **Gmail escalation body renders a raw ISO timestamp in a US Eastern offset.**
   The Telegram nodes format properly with
   `{{ $now.setZone('Asia/Manila').toFormat('yyyy-LL-dd HH:mm') }}`. One-line fix.
10. **The new-order webhook has no signature verification.** Low stakes, trivially
    fixable with an HMAC check node.

---

## Commit log

### Phase 6
`1cc783b` item 1 · `2a63e31` item 2 · `a15f327` item 3 · `3e40d08` + `d502a3c`
item 4 · `4facc9b` item 5 · `760d3ef` handoff · `eeeec34` handoff (emptied the
file — see `2b2f31f`) · `2daeddf` + `fcdc07c` + `c22bb2f` + `7c8e9c1` item 8

### Phase 7
| Commit | Item |
|---|---|
| `1734464` | item 8 — Telegram alert on escalation email failure |
| `a9297a7` | new workflow — Telegram alert on new WooCommerce order |
| `f3d50dc` | new-order alert — ignore payloads with no order id |
| `f05e9f1` | item 9 — intent classification regression suite (31 cases + sync guard) |
| `8ede60f` | item 10 — session-state cases (→ 47 cases) |
| `8472fdc` | fix — quantity after "order" no longer read as an order number (→ 57 cases) |
| `7525e29` | docs — Phase 7 handoff |
| `6c8f515` | docs — correct handoff commit refs and `_pending` contents |
| `69025dc` | fix — cancellation complaints now escalate (→ 65 cases) |
| `48c0def` | fix — `"where is order N"` routes to order_status (→ 69 cases) |
| `2b2f31f` | docs — restore Phase 6 handoff, repair punctuation, mark superseded |
| `f7181db` | docs — add OPERATIONS, N8N_NOTES and TESTING |

---

## Suggested next steps

1. **Finish the docs pass.** `widget\RATE_LIMITING.md` still documents the old
   fixed-window design; `PROJECT_NOTES.md` still needs its staleness banner.
2. **Fix the `ORDER_KEYWORDS` possessive family** — `"where's my order"`,
   `"where's order 771"`, `"track order 771"`, `"status of order 771"` all still
   miss. Same root cause as `48c0def`. A contraction-aware pass would cover
   several at once, but it is a wider keyword change and deserves its own careful
   run. See `docs/TESTING.md`.
3. **Scheduled digest of `unanswered_questions` + `escalations` to Telegram**
   (item 7) — cheap now that the bot exists.
4. **Small cleanups** — trash orders #768 and #771, fix the `00` state code,
   consolidate the four hardcoded email addresses, Manila-format the Gmail
   timestamp, check the WooCommerce default checkout country.
5. **Extend item 9 to non-pure components** — order lookup, escalation, rate
   limiting. Needs a design conversation about fixtures vs live-webhook
   assertions.
6. **Diagnose the LiteSpeed admin CSS problem** — site-ops, but it will keep
   interrupting. Diagnostic path is in `docs/OPERATIONS.md`.
