# Config Inventory

This file lists every value that must be reviewed when deploying this workflow for a different business.

Source files: `n8n/rag-chat-workflow.json` and `n8n/order-lookup-workflow.json`. JSON paths are relative to the file root; `nodes[N]` is the array index.

Two notes:

- `Send Escalation Email (Gmail - OLD)` (nodes[47]) and `Send Escalation Email (Complaint) (Gmail - OLD)` (nodes[49]) have outgoing connections but **no incoming connection** — they're dead legacy nodes. Their values are included but flagged ⚠️dead.
- Rows marked `*` in the cross-reference tables are not Code/Postgres nodes, but are included because they are `$('…')` dependencies that break on rename.

## 1. Hardcoded, deployment-specific values

### `n8n/rag-chat-workflow.json`

| # | Value | Node | JSON path | What it controls |
|---|---|---|---|---|
| **Contact details** | | | | |
| 1 | `dennisphx18@gmail.com` | Escalation Stub | `nodes[3].parameters.jsCode` | Support email shown to customer in the complaint acknowledgement ("reach us directly at …") |
| 2 | `dennisphx18@gmail.com` | No Match Response | `nodes[13].parameters.jsCode` | Support email shown when knowledge base has no match |
| 3 | `https://www.facebook.com/dennis.hermoso1` | No Match Response | `nodes[13].parameters.jsCode` | Facebook contact link in the no-match reply |
| 4 | `dennisphx18@gmail.com` | Escalation Failed Response | `nodes[43].parameters.jsCode` | Fallback email told to customer when SMTP send fails |
| 5 | `dennisphx18@gmail.com` | Send Escalation Email | `nodes[48].parameters.fromEmail` | SMTP sender address (must match SMTP credential account) |
| 6 | `dennisphx18@gmail.com` | Send Escalation Email | `nodes[48].parameters.toEmail` | Inbox that receives complaint escalations |
| 7 | `dennisphx18@gmail.com` | Send Escalation Email (Complaint) | `nodes[50].parameters.fromEmail` | Same as #5, complaint-with-order branch |
| 8 | `dennisphx18@gmail.com` | Send Escalation Email (Complaint) | `nodes[50].parameters.toEmail` | Same as #6, complaint-with-order branch |
| 9 | `dennisphx18@gmail.com` | Send Escalation Email (Gmail - OLD) ⚠️dead | `nodes[47].parameters.sendTo` | Legacy Gmail recipient |
| 10 | `dennisphx18@gmail.com` | Send Escalation Email (Complaint) (Gmail - OLD) ⚠️dead | `nodes[49].parameters.sendTo` | Legacy Gmail recipient |
| **Brand / persona** | | | | |
| 11 | `Cociniña complaint escalation` | Send Escalation Email | `nodes[48].parameters.subject` | Escalation email subject line (brand name) |
| 12 | `Cociniña complaint escalation` | Send Escalation Email (Complaint) | `nodes[50].parameters.subject` | Same, complaint-with-order branch |
| 13 | `Cociniña complaint escalation` | both Gmail - OLD nodes ⚠️dead | `nodes[47].parameters.subject`, `nodes[49].parameters.subject` | Legacy subject |
| 14 | `A customer complaint was flagged by Order Pilot.` | Send Escalation Email / (Complaint) / both Gmail-OLD | `nodes[48].parameters.text`, `nodes[50].parameters.text`, `nodes[47].parameters.message`, `nodes[49].parameters.message` | Product name in escalation email body |
| 15 | `🚨 Order Pilot: escalation email FAILED` | Send a text message | `nodes[46].parameters.text` | Product name in Telegram alert |
| 16 | `You are a customer support assistant for an online food delivery store.` | Ask Claude | `nodes[14].parameters.jsonBody` (inside `system`) | LLM persona / business type |
| 17 | `Do not claim any dish is popular, a best seller, or a customer favorite unless the context explicitly says so.` | Ask Claude | `nodes[14].parameters.jsonBody` (inside `system`) | Food-specific anti-hallucination rule ("dish") |
| 18 | Food vocab in `COMPLAINT_KEYWORDS`: `'cold food'`, `'arrived cold'`, `'wrong food'`, `'spoiled'` | Classify Intent | `nodes[1].parameters.jsCode` | Complaint detection tuned for a food business |
| 19 | Food units in `unitFollows` regex: `servings`, `pax`, `plates`, `bowls`, `packs`, `boxes`, `kilos`, `kgs`, `grams` | Classify Intent | `nodes[1].parameters.jsCode` | Distinguishes "order 20 pieces" (quantity) from "order 20" (order number) — food/catering vocabulary |
| 20 | `Order Pilot - RAG Chat` | (workflow) | `name` | Workflow display name |
| **Numeric thresholds** | | | | |
| 21 | `THRESHOLD = 0.2` | Check Relevance | `nodes[11].parameters.jsCode` | Cosine-similarity cutoff below which the KB is treated as having no answer |
| 22 | `LIMIT 5` | Similarity Search | `nodes[10].parameters.query` | Number of KB chunks retrieved as context |
| 23 | `windowMinutes = 10` | Compute Rate Limit Key | `nodes[19].parameters.jsCode` | Rate-limit window length |
| 24 | `limit: 20` | Compute Rate Limit Key | `nodes[19].parameters.jsCode` | Rate limit (emitted but **not** what the If node actually reads) |
| 25 | `10 * 60 * 1000` | Compute Sliding Window Estimate | `nodes[31].parameters.jsCode` | Window length duplicated — must stay in sync with #23 |
| 26 | `=20` | Over Limit | `nodes[17].parameters.conditions.conditions[0].rightValue` | Actual rate-limit threshold (requests per sliding 10-min window per IP) — duplicated with #24 |
| 27 | `interval '10 minutes'` | Check Recent Escalation | `nodes[36].parameters.query` | Escalation dedupe window per session |
| 28 | `max_tokens: 1024` | Ask Claude | `nodes[14].parameters.jsonBody` | Max answer length |
| 29 | `\d{2,8}` (order-number regexes, 3 places) | Classify Intent | `nodes[1].parameters.jsCode` | Assumes WooCommerce order numbers are 2–8 digits |
| **Timezone** | | | | |
| 30 | `Asia/Manila` | Send a text message | `nodes[46].parameters.text` | Timestamp zone in Telegram alert |
| 31 | `Asia/Manila` | Send Escalation Email | `nodes[48].parameters.text` | Timestamp zone in escalation email |
| 32 | `Asia/Manila` | Send Escalation Email (Complaint) | `nodes[50].parameters.text` | Timestamp zone in escalation email |
| **Telegram** | | | | |
| 33 | `8910263889` | Send a text message | `nodes[46].parameters.chatId` | Telegram chat that receives SMTP-failure alerts |
| 34 | `Telegram - Cocinina Alerts` / `YEQSkeYWGO0VTppE` | Send a text message | `nodes[46].credentials.telegramApi` | Bot token credential (brand name in credential label) |
| **Models / APIs** | | | | |
| 35 | `text-embedding-3-small` | Get Embedding | `nodes[9].parameters.jsonBody` | Embedding model — must match whatever embedded the `documents` table (vector dim 1536) |
| 36 | `claude-sonnet-5` | Ask Claude | `nodes[14].parameters.jsonBody` | Answer-generation model |
| 37 | `2023-06-01` | Ask Claude | `nodes[14].parameters.headerParameters.parameters[0].value` | Anthropic API version header (generic, but pinned) |
| **DB tables / schema assumptions** | | | | |
| 38 | `documents` (cols `content`, `metadata`, `embedding`; `<=>` pgvector op) | Similarity Search | `nodes[10].parameters.query` | KB table; assumes pgvector + this column layout |
| 39 | `rate_limits` (`identifier`, `window_start`, `request_count`; unique on `(identifier, window_start)`) | Upsert Rate Limit, Get Previous Window Count | `nodes[18].parameters.query`, `nodes[30].parameters.query` | Rate-limit storage |
| 40 | `unanswered_questions` (`question`, `session_id`, `reason`, `similarity_score`, `answer_given`) + literals `'below_threshold'`, `'low_confidence_answer'` | Log Below-Threshold Miss, Log Low-Confidence Answer | `nodes[21].parameters.query`, `nodes[25].parameters.query` | KB-gap logging |
| 41 | `pending_intents` (`session_id` PK, `pending_intent`, `order_number`, `email`, `original_question`, `updated_at`) | Load / Save / Clear Pending Intent | `nodes[27]`, `nodes[28]`, `nodes[29]` `.parameters.query` | Multi-turn order-lookup state |
| 42 | `escalations` (`session_id`, `reason`, `question`, `suppressed`, `email_status`, `created_at`) + literal `'failed'` | Check Recent Escalation, Log Escalation, Log Suppressed Escalation, Log Failed Escalation | `nodes[36]`, `nodes[39]`, `nodes[41]`, `nodes[44]` `.parameters.query` | Escalation audit log |
| 43 | `Postgres account` / `nII9UJDNmVB93OrV` | all 13 Postgres nodes | `nodes[N].credentials.postgres` | DB connection |
| **Infrastructure / instance IDs** | | | | |
| 44 | `chat` | Webhook - Chat | `nodes[0].parameters.path` | Public endpoint path the chat widget posts to |
| 45 | `4535089a-f51b-4c01-873d-6fdfe3755396` | Webhook - Chat | `nodes[0].webhookId` | Instance-bound webhook ID |
| 46 | `x-real-ip`, `x-forwarded-for` | Compute Rate Limit Key | `nodes[19].parameters.jsCode` | Assumes a reverse proxy sets these; without one every request is `'unknown'` and shares one rate-limit bucket |
| 47 | `6fL44bKrTJ62bidQ` / `Order Pilot - Order Lookup` | Execute Order Lookup, Execute Order Lookup (Complaint) | `nodes[6].parameters.workflowId.{value,cachedResultUrl,cachedResultName}`, `nodes[33]…` | ID of the sub-workflow — changes on import into another n8n instance |
| 48 | `OpenAI API (Header Auth)` / `0ou3pJ29jMaonr22` | Get Embedding | `nodes[9].credentials.httpHeaderAuth` | OpenAI key |
| 49 | `Anthropic account` / `mb1S4cxbng9KB97A` | Ask Claude | `nodes[14].credentials.anthropicApi` | Anthropic key |
| 50 | `SMTP - Order Pilot Escalation` / `xVTyxbWr80jqN3CC` | Send Escalation Email, Send Escalation Email (Complaint) | `nodes[48].credentials.smtp`, `nodes[50].credentials.smtp` | SMTP account (product name in label) |
| 51 | `Gmail account` / `bfjAaJN4jALKzkVO` | both Gmail - OLD nodes ⚠️dead | `nodes[47].credentials.gmailOAuth2`, `nodes[49].credentials.gmailOAuth2` | Legacy OAuth credential |
| 52 | `OCUB6yBSmVBffeWv`, `versionId`, `meta.instanceId` | (workflow) | `id`, `versionId`, `meta.instanceId` | n8n instance identifiers |
| **Customer-facing copy (English, channel assumptions)** | | | | |
| 53 | `"…flagged this for a team member to follow up with you by email…"` | Format Combined Response | `nodes[34].parameters.jsCode` | Assumes email is the follow-up channel |
| 54 | `"I've already passed this along to our team — someone will follow up with you by email shortly…"` | Escalation Suppressed | `nodes[38].parameters.jsCode` | Same assumption |
| 55 | `"…please wait a few minutes and try again, or email us directly."` | True (over limit) | `nodes[20].parameters.responseBody` | Rate-limit reply |
| 56 | `ORDER_KEYWORDS`, `COMPLAINT_KEYWORDS`, contraction normaliser, `isCancelQuestion` | Classify Intent | `nodes[1].parameters.jsCode` | English-only intent routing |
| 57 | `DECLINE_PHRASES` list | Detect Low-Confidence Answer | `nodes[23].parameters.jsCode` | English phrases coupled to the system prompt's "say you're not sure" instruction — changing #16 may require changing these |

### `n8n/order-lookup-workflow.json`

| # | Value | Node | JSON path | What it controls |
|---|---|---|---|---|
| 1 | `dennisphx18@gmail.com` | Verify & Build Response | `nodes[4].parameters.jsCode` (in `GENERIC_FAIL`) | Support email in the "couldn't verify order" reply |
| 2 | `order-lookup` | Webhook - Order Lookup | `nodes[0].parameters.path` | Public endpoint path (note: unauthenticated) |
| 3 | `4bdcb2af-0699-4c8e-ac5d-0d5e4a68474b` | Webhook - Order Lookup | `nodes[0].webhookId` | Instance-bound webhook ID |
| 4 | `WooCommerce account 2` / `bTt0978QE8WivqYk` | Get Order | `nodes[3].credentials.wooCommerceApi` | Store URL + consumer key/secret live here |
| 5 | `Order Pilot - Order Lookup` | (workflow) | `name` | Display name; also cached in the parent's `cachedResultName` |
| 6 | `6fL44bKrTJ62bidQ` | (workflow) | `id` | Must match `workflowId.value` in the parent's two Execute Workflow nodes |
| 7 | `versionId`, `meta.instanceId` | (workflow) | `versionId`, `meta.instanceId` | Instance identifiers |
| 8 | `••• ` street-mask regex, `Order #… status: … Items: … Total: … Delivery address: …` | Verify & Build Response | `nodes[4].parameters.jsCode` | Response format / privacy masking — generic, but English copy |

## 2. `$('NodeName')` cross-references (Code + Postgres nodes)

### `n8n/rag-chat-workflow.json`

| Referencing node (type) | → Referenced node | What it reads |
|---|---|---|
| Classify Intent (Code) | Webhook - Chat | `.item.json.body.question`, `.item.json.body.sessionId` |
| Classify Intent (Code) | Load Pending Intent | `.item.json` → `pending_intent`, `pending_order_number`, `pending_email`, `pending_question` |
| Have Order Info? (If)* | Classify Intent | `.item.json.orderNumber`, `.item.json.email` |
| Get Embedding (HTTP)* | Classify Intent | `.item.json.question` |
| Check Relevance (Code) | Classify Intent | `.first().json.question` |
| Over Limit (If)* | Compute Sliding Window Estimate | `.first().json.estimatedCount` |
| Compute Rate Limit Key (Code) | Webhook - Chat | `.item.json.headers['x-real-ip']`, `['x-forwarded-for']` |
| Log Below-Threshold Miss (Postgres) | Webhook - Chat | `.item.json.body.question`, `.body.sessionId` |
| Log Below-Threshold Miss (Postgres) | Check Relevance | `.item.json.topSimilarity` |
| Rebuild No-Match Answer (Code) | No Match Response | `.item.json.answer` |
| Detect Low-Confidence Answer (Code) | Format Response | `.item.json.answer` |
| Log Low-Confidence Answer (Postgres) | Webhook - Chat | `.item.json.body.question`, `.body.sessionId` |
| Log Low-Confidence Answer (Postgres) | Check Relevance | `.item.json.topSimilarity` |
| Log Low-Confidence Answer (Postgres) | Format Response | `.item.json.answer` |
| Rebuild Answer After Log (Code) | Format Response | `.item.json.answer` |
| Load Pending Intent (Postgres) | Webhook - Chat | `.item.json.body.sessionId` |
| Save Pending Intent (Postgres) | Classify Intent | `.item.json.sessionId`, `.intent`, `.orderNumber`, `.email`, `.question` |
| Clear Pending Intent (Postgres) | Webhook - Chat | `.item.json.body.sessionId` |
| Get Previous Window Count (Postgres) | Compute Rate Limit Key | `.item.json.rateLimitIp`, `.previousWindowStart` |
| Compute Sliding Window Estimate (Code) | Upsert Rate Limit | `.first().json.request_count` |
| Compute Sliding Window Estimate (Code) | Get Previous Window Count | `.first().json.previous_count` |
| Compute Sliding Window Estimate (Code) | Compute Rate Limit Key | `.item.json.windowStart` |
| Format Order Response (Code) | Execute Order Lookup | `.item.json.message` |
| Format Combined Response (Code) | Execute Order Lookup (Complaint) | `.item.json.message` |
| Rebuild Answer (Clean) (Code) | Format Response | `.item.json.answer` |
| Check Recent Escalation (Postgres) | Webhook - Chat | `.item.json.body.sessionId` |
| Already Escalated? (If)* | Check Recent Escalation | `.item.json.recent_count` |
| Log Escalation (Postgres) | Webhook - Chat | `.item.json.body.sessionId`, `.body.question` |
| Log Escalation (Postgres) | Classify Intent | `.item.json.intent` |
| Rebuild Escalation Answer (Code) | Escalation Stub | `.item.json.answer` |
| Log Suppressed Escalation (Postgres) | Webhook - Chat | `.item.json.body.sessionId`, `.body.question` |
| Log Suppressed Escalation (Postgres) | Classify Intent | `.item.json.intent` |
| Rebuild Suppressed Answer (Code) | Escalation Suppressed | `.item.json.answer` |
| Log Failed Escalation (Postgres) | Webhook - Chat | `.item.json.body.sessionId`, `.body.question` |
| Log Failed Escalation (Postgres) | Classify Intent | `.item.json.intent` |
| Rebuild Failed Answer (Code) | Escalation Failed Response | `.item.json.answer` |
| Send a text message (Telegram)* | Webhook - Chat | `.item.json.body.sessionId` |
| Send a text message (Telegram)* | Classify Intent | `.item.json.question` |
| Send Escalation Email / (Complaint) / both Gmail-OLD* | Webhook - Chat | `.item.json.body.question`, `.body.sessionId` |

\* Not a Code/Postgres node, included for completeness since it's a `$('…')` dependency that breaks on rename.

### `n8n/order-lookup-workflow.json`

| Referencing node (type) | → Referenced node | What it reads |
|---|---|---|
| Verify & Build Response (Code) | Normalize Input | `.first().json` → `orderNumber`, `email`, `viaWebhook` |

## 3. Observations worth acting on when parameterising

- **`dennisphx18@gmail.com` appears 11 times** across 9 nodes (3 customer-facing replies, from/to on 2 SMTP nodes, 2 dead Gmail nodes, order-lookup fail message). A single "support email" setting would replace all of them.
- **Rate limit `20` is defined twice** (`Compute Rate Limit Key` emits `limit: 20` but `Over Limit` compares against its own literal `=20`) and the **10-minute window is defined twice** (`Compute Rate Limit Key` and `Compute Sliding Window Estimate`). Change one without the other and the sliding-window estimate is silently wrong.
- **`Asia/Manila` appears 3 times** and there is no workflow-level timezone setting in `settings`.
- The **food-domain assumptions** aren't only in the system prompt — they're baked into `Classify Intent` (complaint keywords, quantity-unit regex) and `Detect Low-Confidence Answer` (phrases coupled to the prompt's wording).
- The **two Gmail - OLD nodes** are dead (no inbound connection) but still carry the old email, subject and OAuth credential; they'd be safe to delete before templating.

## 4. Known defects found during inventory

- **The rate limit is defined in three places and they disagree.** `Compute Rate Limit Key` (`nodes[19]`) emits `limit: 20`; `Over Limit` (`nodes[17]`) compares against its own literal `=20` and ignores the emitted value; and the 10-minute window is duplicated in `Compute Rate Limit Key` (`windowMinutes = 10`) and `Compute Sliding Window Estimate` (`nodes[31]`, `10 * 60 * 1000`). Changing one without the others is silently wrong.
- **`dennisphx18@gmail.com` appears in the order-lookup sub-workflow** (`Verify & Build Response`, `nodes[4].parameters.jsCode`), which a config node in the parent workflow cannot reach. Sub-workflows only see passed input, so the support email must either be passed in as a workflow input or configured separately in the sub-workflow.
- **The two Gmail - OLD nodes are dead but still carry the old email, subject and OAuth credential** (`nodes[47]`, `nodes[49]`: `sendTo`, `subject`, `credentials.gmailOAuth2`). They have no inbound connection and will never run, but they keep the stale values (and a credential reference) in the exported JSON.
