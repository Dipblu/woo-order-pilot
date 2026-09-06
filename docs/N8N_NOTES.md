# Order Pilot — n8n Notes

Durable knowledge about working with n8n on this project: the rules that were
learned the hard way, the bug patterns that keep recurring, and the export and
commit procedure.

**Not superseded each phase.** Fix things here rather than re-recording
corrections in a handoff.

Last verified: 2026-09-06.

---

## Working environment

- **Split environment.** Claude Code has the repo. n8n, Supabase and WordPress
  are browser-only. Never plan around programmatic access to them.
- **n8n is the source of truth for workflow behaviour.** Do **not** edit the
  workflow JSON in the repo directly — edit in n8n, export, and copy the export
  over the repo file.
- **Verify in production, not the editor.** Every fix is confirmed by a real
  request through the live webhook.
- **Executions tab, not the Editor canvas.** The Executions detail panel does
  **not** follow the newest run — click the run by timestamp first.
- **Export is ⋯ menu → Download.** "Push to git" is a paid feature and is
  greyed out.

### Terminal

PowerShell 5.1 in VS Code.

- `grep` does not exist — use `Select-String`.
- Always `cd "C:\Users\My PC\Projects\Woo-Chatbot"` first.
- `Invoke-WebRequest` needs `-UseBasicParsing` on this machine.
- `Join-String` does not exist (PowerShell 7+ only). Use
  `($items | ForEach-Object { ... }) -join " "`.
- **Avoid multi-line strings with backtick-escaped quotes.** A replace built that
  way left the terminal stuck at `>>`. For text edits in repo files, edit in
  VS Code instead.
- `@'...'@` here-strings are **literal** — quote doubling does not collapse.
- Escape `$json` as `` `$json` `` in git commit messages.

### Files from chat

**Files downloaded from chat land in `C:\Users\My PC\Downloads`, not the repo.**
They must be `Move-Item`'d into place. This has cost several round-trips — a test
suite kept "passing" at the old count because the new file was still in
Downloads.

**Always verify with a line count or `Test-Path` after moving.**

### VS Code

- Often in "No Folder Opened" state — File → Open Folder on the repo.
- The Open Folder dialog only lists directories, so it never shows a `.ts` file.
  That is not evidence the file is missing.
- **Close any repo JSON open in a VS Code tab before copying an export over it.**

---

## ⚠️ THE `=` PREFIX RULE

*Caused a production outage on 2026-08-22.*

Exported workflow JSON stores expressions with a **leading `=`**:

```json
"jsonBody": "={{ ... }}"
```

The n8n UI expression editor does **not** want it. Pasting a repo-copied
expression verbatim fails as **"The value in the JSON Body field is not valid
JSON"**.

- Paste into UI expression fields **without** the `=`.
- **Always check the expression editor's Result panel before saving:**
  - `[invalid syntax]` → broken.
  - `[Execute previous nodes for preview]` → parses fine. That is a pass.
- Code node JS has no `=` prefix and is unaffected.
- **`Similarity Search`'s apparently-missing `=` is a CONFIRMED FALSE POSITIVE.**
  Do not "fix" it.

---

## ⚠️ CODE NODE EDITING RULE

*Caused a silent node wipe on 2026-08-22.*

**Never edit a single line in a Code node.** Always supply the complete node
body: select-all → delete → paste.

After pasting, **confirm the modal shows the expected number of lines.** Count
carefully before stating the number — a wrong count was stated twice in Phase 7
and caused false alarms. Phrase it as "should be N — tell me if it differs."

---

## n8n canvas behaviour

### Auto-insert

Dropping a node near an existing connection makes n8n **splice it into that
connection**. Instead:

1. Add the node via the canvas `+` button (it lands unconnected).
2. Place it in empty space.
3. Draw the connections by hand.

Screenshot and verify the wiring before configuring anything.

### One output dot ≠ one connection

A single n8n output dot supports **multiple outgoing connections**, and n8n runs
all branches. This is how the Telegram alert hangs off `Rebuild Failed Answer` in
parallel with `Respond to Webhook`.

This is different from a node's *error output*, which is a second dot created by
setting On Error = "Continue (using error output)".

⚠️ `Rebuild Failed Answer` was once accidentally switched to "Continue (using
error output)" during a drag, and its connection to `Respond to Webhook` went
missing. **After any On Error change, verify the node's existing connections
survived.**

To check a node's connections on a crowded canvas, click the node once — n8n
highlights its own connections and dims the rest.

### On Error semantics

`Send Escalation Email` uses **On Error = "Continue (using error output)"**,
giving Success and Error branches.

Plain "Continue" is **WRONG** here — it routes errors down the success path and
tells the customer a human was notified when none was.

---

## ⚠️ THE RECURRING BUG PATTERN

**Bare `$json` in a Code or Postgres node resolves to whatever the immediately
preceding node output — not the webhook.**

Insert anything upstream and it silently becomes `undefined`. The node still
reports success. **Five occurrences so far.**

Always reference the source explicitly:

```js
$('Webhook - Chat').item.json.body.question
```

**Do not touch:** `Compute Rate Limit Key`, and `Normalize Input` in the
order-lookup workflow. **Left bare deliberately:** the `...$json` spread in
`Detect Low-Confidence Answer`.

### Related silent failures

- **A Postgres node returning zero rows outputs zero items**, silently killing
  the branch while showing green. Write lookups with scalar subqueries, or a CTE
  plus count.
  - **This behaviour is now used deliberately**: `Format Order Alert` returns
    `[]` for a non-order payload, so the Telegram node receives zero items and
    does not fire.
- **A Postgres `RETURNING` clause replaces the item**, wiping `answer` before
  `Respond to Webhook`. This is why **five rebuild nodes exist**:
  `Rebuild Answer After Log`, `Rebuild No-Match Answer`,
  `Rebuild Escalation Answer`, `Rebuild Suppressed Answer`,
  `Rebuild Failed Answer`.
- **n8n drops `undefined` keys in `JSON.stringify`.**
- **Static analysis of this workflow produces confident false positives.**
  Cross-check any audit finding against real execution history.

---

## Export and commit

Use this exact procedure. Each numbered action is its own step — "download the
workflow, then run this" reads as one step and the download gets skipped.

1. In n8n: **SAVE**, then **DOWNLOAD** (⋯ → Download).
2. Verify the download is new — check `LastWriteTime`.
3. Copy into the repo and prove the change is in the file:

```powershell
cd "C:\Users\My PC\Projects\Woo-Chatbot"
$latest = Get-ChildItem "$env:USERPROFILE\Downloads\Order Pilot - RAG Chat*.json" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$latest.Name
$latest.LastWriteTime   # CONFIRM this is minutes old
Copy-Item $latest.FullName "n8n\rag-chat-workflow.json" -Force
Select-String -Path "n8n\rag-chat-workflow.json" -Pattern "<something unique to the change>" -SimpleMatch
```

Other workflows:

| Download | Repo path |
|---|---|
| `Order Pilot - RAG Chat*.json` | `n8n\rag-chat-workflow.json` |
| `Order Pilot - Order Lookup*.json` | `n8n\order-lookup-workflow.json` |
| `Order Pilot - New Order Alert*.json` | `n8n\new-order-alert-workflow.json` |

4. **Only commit once `Select-String` proves the change is in the file.**
5. Review `git diff --stat` first. A node addition should be nearly all
   insertions; unexplained deletions warrant:

```powershell
git diff -U1 | Select-String "^-"
```

A `jsCode` change shows as only a few lines, because the whole node body is one
JSON string.

### Verify writes produce bytes

A write can silently produce **nothing**. `docs/order-pilot-phase6-handoff.md`
was committed as a 0-byte file, replacing 15KB of content, and stayed that way
for a week.

Line count, `Test-Path`, or `Select-String` — check before every commit, for
documentation as much as for workflow JSON. See the encoding hazards section in
`OPERATIONS.md`.

---

## Workflows

Four, all Published:

| Workflow | Purpose |
|---|---|
| **Order Pilot - RAG Chat** | main chat agent |
| **Order Pilot - Order Lookup** | WooCommerce order lookup sub-workflow |
| **Order Pilot - New Order Alert** | Webhook → Format Order Alert → Telegram |
| **Order Pilot - Rate Limit Cleanup** | Schedule Trigger (daily 3am) → Postgres delete of rows older than 2 days. Uses `RETURNING 1` (there is no `id` column) |

### Main RAG chat structure

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

### New Order Alert

```
Webhook (POST /webhook/new-order, Respond: Immediately)
→ Format Order Alert (Code)
→ Send a text message (Telegram)
```

---

## Endpoints and data

| Item | Value |
|---|---|
| n8n instance | `https://dmhermoso.cloud` (self-hosted, nginx 1.24 direct, no CDN) |
| Chat webhook | `https://dmhermoso.cloud/webhook/chat` — JSON body key is **`question`**, NOT `message` |
| Order-lookup webhook | `https://dmhermoso.cloud/webhook/order-lookup` |
| New-order webhook | `https://dmhermoso.cloud/webhook/new-order` |
| Vector store | Supabase (Postgres + pgvector), ap-northeast-2 |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dim) |
| LLM | Anthropic Claude (`claude-sonnet-5`) |

### Supabase

Tables: `documents`, `rate_limits`, `unanswered_questions`, `pending_intents`,
`escalations`.

- **`documents`** — 14 rows `metadata.source='faq'` (faq-001…faq-014), 9 rows
  `metadata.source='product'`. FAQ identifier is `metadata.faq_id`; product
  identifier is `metadata.name`.
  **`source` is NOT a column** — query it as `metadata->>'source'`.
- **`rate_limits`** — `identifier`, `window_start`, `request_count`. No `id`
  column.
- **`escalations`** — `session_id`, `reason`, `question`, `suppressed` (bool,
  default false), `email_status` (text, default `'sent'`), `created_at`.
  No `id` column — use `returning 1 as logged`.

Migrations: `migrations\001_rate_limits.sql`, `002_escalations.sql`,
`003_escalation_email_status.sql`.

**The user's IP rotates between sessions:**

```sql
select * from rate_limits order by window_start desc limit 5;
```

### Ingest

**Editing WooCommerce products changes nothing until `npm run ingest:products`
is re-run.** Same for `src/data/faqs.json` and `npm run ingest:faqs`.

`src/data/faqs.json` is the only local data file — products are fetched live
from WooCommerce during ingest. It picks up CRLF after PowerShell round-trips,
which is harmless but makes noisy diffs.

The 9 dishes: Ginataang Hipon, Tofu Sisig, Pork Adobo, Lumpiang Shanghai,
Special Chicken Adobo, Crispy Lechon Kawali, Sizzling Sisig, Chicken Curry,
Sweet and Spicy Laing.
