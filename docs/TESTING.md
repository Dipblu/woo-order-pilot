# Order Pilot — Testing

What is covered, what is not, and why the tests are shaped the way they are.

**Not superseded each phase.** Fix things here rather than re-recording
corrections in a handoff.

Last verified: 2026-10-27.

---

## The suites

| Script | What it does | Needs live services |
|---|---|---|
| `npm run test:intent` | 69 intent-classification cases | no |
| `npm run test:intent-sync` | 7 drift checks between repo and n8n | no |
| `npm run test:ratelimit` | 21 rate-limiter cases: the 21st request trips, sliding-window overlap maths, boundary burst, clamp, IP resolution | no |
| `npm run test:ratelimit-sync` | 10 drift checks between `src/lib/ratelimit.ts` and the rate-limit nodes in n8n (including "no literal threshold or window creeps back") | no |
| `npm run test:escalation-sync` | 13 structural checks on the escalation path in the n8n export: SMTP not Gmail, Config-driven addresses with the `=` prefix, error outputs wired, honest failure reply, Telegram alert cannot block the reply, Config node intact | no |
| `npm run test:retrieval` | 26 retrieval cases, `MATCH_WITHIN = 3` | yes (Supabase + OpenAI) |
| `npm run test:connection` | connectivity smoke test | yes |

`test:intent` and `test:intent-sync` both run in under a second with no live
services. **Run them before every commit.**

### House style

**No test runner was added.** The suites follow the existing `test-retrieval.ts`
style: a flat `TEST_CASES` array, an `X/Y passed` line, a `FAILURES:` block, and
`process.exit(1)` on failure.

Rationale: the project is `"type": "module"` with no test config and no test
dependencies. Adding Jest or Vitest to run a few hundred string comparisons would
be a larger change than the thing being tested.

A case looks like this:

```ts
{ name: 'where is my order', message: 'where is my order?', expect: { intent: 'order_status' } },
```

`expect` only asserts the fields it names — a case that cares about intent but
not the extracted order number simply omits `orderNumber`.

### Files

| File | Purpose |
|---|---|
| `src/lib/intent.ts` | pure `classifyIntent(message, pending)`, no n8n globals. Exports `ORDER_KEYWORDS`, `COMPLAINT_KEYWORDS` |
| `src/scripts/test-intent.ts` | the 69 cases |
| `src/scripts/test-intent-sync.ts` | the 7 drift checks |

---

## ⚠️ The drift problem

**n8n Code nodes cannot import from the repo.** So `src/lib/intent.ts` is
necessarily a **second copy** of the logic that lives in the `Classify Intent`
node. The two can silently diverge.

### What was rejected

A generator that rewrites the n8n node body from `intent.ts` was **considered and
rejected.** It would mean replacing the most failure-prone node in the workflow
with generated output, with no verification path other than production traffic.

### What was built instead

`test-intent-sync.ts` reads `n8n/rag-chat-workflow.json`, extracts the
`Classify Intent` node's `jsCode`, and asserts:

1. `ORDER_KEYWORDS` matches exactly
2. `COMPLAINT_KEYWORDS` matches exactly
3. all four extraction regexes are present
4. the cancel exclusion is present
5. the continuation branch is present
6. the continuation branch is ordered first
7. the `$('Webhook - Chat')` question reference is intact

### Its limitation, stated plainly

**It does not prove the whole node is identical.**

It did **not** detect the quantity fix, because the guard checks that
`/order\s*#?\s*(\d{2,8})/` is *present*, and that fix wrapped the regex rather
than replacing it.

It **does** reliably detect keyword-list changes. That has been confirmed in
practice: during the cancel fix, with `intent.ts` updated and the n8n node not
yet updated, the guard failed on `COMPLAINT_KEYWORDS` exactly as designed.

**n8n remains the source of truth for behaviour.** The guard catches a specific
and common class of drift; it is not a proof of equivalence.

### Two more guards read the same export

`test-ratelimit-sync.ts` (rate-limit nodes vs `src/lib/ratelimit.ts`) and
`test-escalation-sync.ts` (escalation structure) use the same technique and have
the same limitation: they check what they list, not whole-node equivalence. All
three are also stale-export detectors, because a stale export fails them. Run
all three before every commit.

### Expect a transient sync failure mid-change

When applying a keyword change, the correct order is repo first, then n8n.
Between those two steps `test:intent-sync` **will fail** on the keyword list.
That is the guard working. Do not "fix" it by reverting the repo change.

---

## Working procedure for an intent change

This sequence is what the last two fixes used, and it works:

1. Change `src/lib/intent.ts`.
2. Add or update cases in `src/scripts/test-intent.ts`.
3. `npm run test:intent` — must pass before n8n is touched.
4. Paste the full node body into `Classify Intent` (select-all → delete →
   paste), confirm the line count, save.
5. Test against the live webhook with a **fresh sessionId per message**.
6. Export from n8n, copy into the repo, prove the change is in the JSON with
   `Select-String`.
7. `npm run test:intent-sync` — now 7/7.
8. Review `git diff --stat`, commit all three files together.

**Fresh sessionIds matter.** Escalation dedup uses a 10-minute window, so
re-testing a complaint with a reused sessionId returns a *suppressed* response
rather than an escalation, which looks like a failure but isn't.

```powershell
$sid = "test-" + (Get-Random)
$body = @{ question = "..."; sessionId = $sid } | ConvertTo-Json
Invoke-WebRequest -Uri "https://dmhermoso.cloud/webhook/chat" -Method POST -ContentType "application/json" -Body $body -UseBasicParsing
```

---

## Known behaviours recorded as test cases

These are **pinned deliberately**. They are recorded because they are surprising,
not because they are endorsed. Changing any of them should be a decision, not an
accident.

### QUIRK — continuation outranks a fresh complaint

With a pending intent, `"order 771 me@x.com and the food was terrible"` routes to
order lookup, not escalation. The continuation branch is checked first.

Untested in production. Probably not intended.

### QUIRK — a cancel mention beats an order query

`"where is order 771, I want to cancel it"` routes to `faq`.

The cancel exclusion gates the **entire** keyword branch:

```js
(!isCancelQuestion && ORDER_KEYWORDS.some((k) => lower.includes(k)))
```

So it does not matter which keyword would have matched. Arguably wrong — the
customer wants both a location and a cancellation — but it is structural, not a
keyword problem.

### GAP — no staleness concept for pending intents

A pending intent from three days ago continues as readily as one from thirty
seconds ago, and **replaces the customer's current question with the stored
one**.

This is missing functionality in `pending_intents`, not a test problem. There is
no staleness logic to test.

### GAP — `ORDER_KEYWORDS` depends on the possessive

Several natural phrasings still miss, because the keywords contain "my":

| Message | Why it misses |
|---|---|
| `where's my order` | `'where is my'` does not match the contraction |
| `where's order 771` | same |
| `track order 771` | keyword is `'track my'` |
| `status of order 771` | keyword is `'status of my order'` |

`where is order` was added on 2026-09-06 to fix the reported case. The rest of
the family is deliberately left for a separate pass — a wider keyword change is a
wider surface for surprises in the most failure-prone node in the workflow.

**Note:** `'where is'` alone would be too broad. It would catch
`"where is your store located?"`, which is a legitimate FAQ question. There is a
test case pinning that.

---

## ⚠️ A gap fix usually means deleting its own test

When a GAP is recorded as a test case, that case asserts the **broken**
behaviour. Fixing the gap makes it fail.

This happened on 2026-09-06: after adding `'where is order'`, the suite reported

```
GAP "where is order N" extracts the number but routes to faq
  Message: "where is order 771"
  intent: expected "faq", got "order_status"
```

That is the correct outcome, not a regression. The stale case was deleted and the
new correctly-asserting cases replaced it.

**Expect this on every gap fix.** Check whether the failing case is one that
documented the old behaviour before assuming something broke.

---

## Coverage

### Covered

- Intent classification — 69 cases: plain FAQ, order-status keywords, complaints,
  `complaint_with_order`, cancel requests vs cancel complaints, order-number vs
  quantity extraction, email extraction, session-state continuations, partial
  replies, unrelated follow-ups.
- Repo/n8n keyword drift — 7 checks.
- Retrieval — 26 cases (requires live Supabase + OpenAI).
- Rate-limiter maths — 21 cases against `src/lib/ratelimit.ts` with the clock
  pinned and `rate_limits` replaced by an in-memory table: requests 1-20 pass and
  the 21st is blocked, overlap weighting at the start / halfway / end of a window,
  the clamp at 0, the boundary burst a fixed window would allow, window length
  derived from the keys, IP resolution. Each case was checked to fail when the
  logic it guards is broken.
- Rate-limiter drift — 10 checks that the n8n nodes still match `ratelimit.ts`
  and that no literal limit or window is back in `Over Limit` or the estimate
  node. Also pins the SQL shape: atomic `ON CONFLICT ... + 1 RETURNING`, and
  `COALESCE(..., 0)` on the previous-window read.

- Escalation structure — 13 checks (`test-escalation-sync.ts`) that the exported
  workflow still has: no Gmail nodes or OAuth credentials (the 7-day token expiry
  class of failure), both escalation emails as SMTP, From / To / Subject / time
  zone read from Config with the leading `=` kept (`afb29ff`), On Error =
  "Continue (using error output)" with the error output wired to the failure
  reply, a failure reply that never claims the team was told, the Telegram alert
  unable to block the customer reply (`d3261b7`), the order number and customer
  email present in the complaint-with-order email, and the Config node still
  passing the webhook body through. Each check was verified to fail when the
  thing it guards is broken. This proves STRUCTURE only: whether SMTP really
  delivers still needs a real complaint sent through the widget.

QUIRKs recorded in the rate-limit suite: blocked requests still count, so a
100-request burst is not released until ~80% into the next window; and every
request with no usable IP header shares one `unknown` bucket.

### Not covered

| Area | Why it is hard |
|---|---|
| Order lookup | needs a live webhook or WooCommerce fixtures |
| Escalation, delivery | the structure is guarded; that SMTP actually sends needs the live credential. Verify by sending a real complaint and checking the inbox |
| Rate limiting, SQL half | the formula is covered; the SQL is only string-checked. Whether the upsert really increments and `COALESCE` really returns 0 needs a real Postgres |
| Load / concurrency | `ON CONFLICT DO UPDATE` under concurrent upserts is assumed correct, not verified |
| Stale pending intents | there is no staleness logic to test |

None of these are pure functions, so none fit the current suite's shape. Covering
them needs a design conversation about **fixtures vs hitting the production
webhook and asserting on the response** — that is its own piece of work, not an
extension of the intent suite.

---

## Data dependencies

`test:retrieval` depends on the seeded FAQ content. In particular **faq-013's
question text is deliberately broadened** — narrowing it will fail the suite.

`test:retrieval` uses `MATCH_WITHIN = 3`: the expected document must appear in
the top 3 results, not necessarily first.

Re-running ingest changes what retrieval returns:

```powershell
npm run ingest:faqs        # after editing src/data/faqs.json
npm run ingest:products    # after editing WooCommerce products
```

**Editing WooCommerce products changes nothing until ingest is re-run.**

### Similarity thresholds are tuned by eye, and no suite covers them

Two magic numbers gate answer quality, and both are specific to
`text-embedding-3-small` plus this corpus:

| Value | Where | What it does |
|---|---|---|
| `0.2` | `Check Relevance` | below this, no answer is attempted at all |
| `0.5` | `Should Log Low Confidence?` | below this, a given answer is logged as low confidence |

The 0.5 floor was added 2026-09-19 and **tuned by eye against 13 rows.**
Observed genuine declines fell at 0.41-0.47; answers that were actually
good fell at 0.52+. The gap is narrow and the sample is small. Revisit
once more rows accumulate.

Before that change, `DECLINE_PHRASES` alone decided the logging, so any
answer containing a hedge was logged - roughly a third of
`low_confidence_answer` rows were answers that had worked. The AND
condition on similarity is what fixed it.

**Neither number is covered by any suite.** `test:retrieval` asserts that
the right document ranks in the top 3; it says nothing about where the
score lands relative to either threshold. A model swap or a corpus change
moves both bands and no test will fail. Re-tune by hand against fresh
rows.
