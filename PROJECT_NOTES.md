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

Phase 2 (Order Lookup Tool + Core Agent Logic) — built:

Decisions:
- Identity verification: order number + billing email must both match via the WooCommerce
  order lookup. On any mismatch (wrong number, wrong email, or order not found), the customer
  gets one generic "couldn't verify" message — the response never reveals which piece was
  wrong, so a wrong order number can't be distinguished from a wrong email (avoids leaking
  which order numbers are valid).
- Complaints/anything not confidently resolvable route to an escalation stub (canned "flagged
  for a human, email us if urgent" reply) rather than being answered — full email escalation
  build is a later phase.
- Intent classification is a **free heuristic Code node** (regex + keyword matching), not an
  extra Claude call. Reasoning: the existing flow already spends zero LLM cost on off-topic
  questions (similarity check short-circuits before ever calling Claude). Adding an upfront
  Claude classification call would have meant paying for a Claude call on *every* message,
  including ones that end up being canned no-match replies today — a real cost regression.
  The heuristic router (keyword lists for order-status vs. complaint intent, regex for order
  number + email extraction) runs before anything else and costs nothing; only the FAQ
  fallback path reaches Claude, same as before. Tradeoff: lower recall than an LLM classifier
  for unusually-phrased messages — acceptable for v1, revisit if real traffic shows
  misclassification.

n8n/order-lookup-workflow.json (new, "Order Pilot - Order Lookup"):
- Two triggers feeding the same logic: "Webhook - Order Lookup" (POST /order-lookup, body
  { orderNumber, email }) for standalone testing/curl, and "When Executed by Another Workflow"
  (Execute Workflow Trigger) so the main chat workflow can call it directly without depending
  on webhook publish/activation at all — sidesteps the flaky Publish/Active toggle noted in
  Phase 1.
- Normalize Input (Code) — detects which trigger fired by shape (`$json.body` present =
  webhook), trims/lowercases email.
- Get Order — native WooCommerce node (credential "WooCommerce account 2"), resource "order",
  operation "get", orderId = orderNumber. continueOnFail true so a 404 becomes a checkable
  `error` field instead of crashing the workflow. Assumption: the customer-facing order number
  equals the WooCommerce order ID (true by default; would need adjusting if a custom
  order-numbering plugin is in use — worth confirming).
- Verify & Build Response (Code) — compares lowercased order.billing.email to the provided
  email; only on exact match does it build the real order summary (status, line items, total,
  delivery address from shipping or billing). Any failure (bad number, bad email, not found)
  returns the same generic verification-failed message.
- Called Via Webhook? (IF) — routes to Respond to Webhook when triggered standalone, or to a
  no-op terminal node when called as a sub-workflow (Execute Workflow just returns the last
  node's output, no explicit response needed).
- **Post-import step required**: open the "Execute Order Lookup" node in the main chat
  workflow and re-select "Order Pilot - Order Lookup" from its workflow dropdown — the target
  workflow ID is assigned by n8n at import time and can't be hardcoded in the JSON file.

n8n/rag-chat-workflow.json (updated) — new nodes inserted right after the webhook:
- Classify Intent (Code) — regex-extracts an email and an order-number-looking token from the
  message, checks keyword lists for order-status phrases ("track my", "where is my", etc.) and
  complaint phrases ("refund", "never arrived", "manager", "escalate", etc.). Priority:
  complaint > order_status > faq (default). Outputs { question, intent, orderNumber, email }.
- Is Complaint? (IF) → true: Escalation Stub (canned reply) → Respond to Webhook.
- Is Order Status? (IF, false branch of above) → true: Have Order Info? (IF checking both
  orderNumber and email were extracted) →
  - true: Execute Order Lookup (Execute Workflow node → order-lookup workflow) → Format Order
    Response (wraps the sub-workflow's `message` into `answer`) → Respond to Webhook
  - false: Ask For Order Info (canned "please share your order number and email") → Respond
    to Webhook
  - false branch of Is Order Status?: falls through to the existing FAQ path unchanged (Get
    Embedding → Similarity Search → Check Relevance → Relevance Check → Ask Claude / No Match
    Response → Format Response), which still all converges on the same Respond to Webhook node.
- Bug caught and fixed while wiring this up: Get Embedding originally read
  `$json.body.question` directly off the webhook item; since Classify Intent now sits between
  the webhook and Get Embedding and flattens the shape to `{ question, intent, ... }` (no
  nested `.body`), Get Embedding was updated to read `$json.question` instead.

Testing the order-lookup path end-to-end:
1. In WooCommerce admin, find or create a test order; note its order ID/number and the
   billing email on that order.
2. Import n8n/order-lookup-workflow.json as its own workflow, then re-point the main
   workflow's "Execute Order Lookup" node at it (see post-import step above).
3. Standalone test (bypasses the chat flow entirely) — open the order-lookup workflow, click
   "Listen for test event" on Webhook - Order Lookup, then:
   - Success case: POST to the webhook-test URL with
     `{ "orderNumber": "<real id>", "email": "<real billing email>" }` — expect
     `{ success: true, message: "Order #... status: ...", order: {...} }`.
   - Failure case: same orderNumber but a wrong/different email — expect
     `{ success: false, message: "We couldn't verify..." }`. Repeat with a wrong orderNumber
     and the correct email to confirm the message is identical either way (no leak of which
     field was wrong).
4. End-to-end through the chat flow — open rag-chat-workflow, click "Listen for test event"
   on Webhook - Chat, then POST
   `{ "question": "What's the status of order <id>, my email is <billing email>" }` to the
   chat webhook-test URL — expect intent to route to order_status and a real order summary
   back. Repeat with a mismatched email in the same phrasing to confirm the generic failure
   message comes back through the full chat path, and try a message with only an order number
   (no email) to confirm it asks for the missing info instead of guessing.
5. Sanity-check the other two routes still work post-change: a complaint-flavored message
   ("this order never arrived, I want a refund") should hit the Escalation Stub reply, and the
   original FAQ questions from Phase 1 testing should still reach Claude/no-match exactly as
   before.

Phase 2 verified live end-to-end (2026-08-02) — both workflows imported into the real n8n
instance (dmhermoso.cloud) and tested against a real WooCommerce test order (order #754,
billing email orderpilot.test@example.com, created via the REST API for this test since the
store had no existing orders):
- Order-lookup sub-workflow tested standalone via its own webhook: correct number+email →
  full order summary; wrong email → generic fail; wrong (nonexistent) order number → identical
  generic fail message (confirms no leak of which field was wrong).
- Main chat workflow tested end-to-end via the chat webhook for all routes: order-status
  success, order-status wrong email, order-status with missing info (asks for order number +
  email instead of guessing), complaint → escalation stub, FAQ in-scope (grounded Claude
  answer), FAQ off-topic (canned no-match reply). All six passed.
- Import gotchas hit and fixed along the way, worth remembering for future n8n workflow
  imports on this instance:
  - Hand-authored node `position` coordinates that reuse the same x/y as other nodes (e.g.
    inserting new nodes without shifting the existing chain) cause nodes to visually overlap
    on the canvas, making them nearly impossible to click/select in the editor. Give new nodes
    plenty of vertical/horizontal clearance (≥150px) from existing ones when hand-editing
    workflow JSON.
  - Credentials referenced by name with an empty `id` in imported JSON do NOT always
    auto-match on import — WooCommerce and Anthropic credentials happened to auto-bind
    correctly, but the OpenAI (Header Auth) and Postgres credentials did not and silently
    showed the right name with a broken binding ("Credentials not found" only surfaced at
    execution time). After importing a workflow JSON with credentials, re-open every node that
    has one and reselect it from the dropdown even if the name already looks populated.
  - Execute Workflow node → sub-workflow references (`workflowId`) are never valid after
    import since n8n assigns the ID at import time; the node showed a red warning until the
    target workflow was manually reselected from the "From list" dropdown.
  - An Execute Workflow Trigger node with no input schema defined throws "At least 1 field is
    required" when called — set "Input data mode" to "Accept all data" (not "Define using
    fields below" left empty) for sub-workflows that should just pass through whatever the
    caller sends.
  - This n8n instance's canvas "Zoom to Fit" button was unreliable for large/spread-out
    workflows (repeatedly centered on empty space); manually clicking "Zoom Out" several times
    was the reliable way to bring all nodes into view.

Production webhooks activated (2026-08-02) — both workflows Published/Active in n8n:
- Order-lookup: https://dmhermoso.cloud/webhook/order-lookup — tested directly (success +
  wrong-email cases), both correct.
- Chat: https://dmhermoso.cloud/webhook/chat — tested for all three intents, all correct.
- Important: the chat webhook expects the JSON body key to be `question`, not `message`
  (`{"question": "..."}`). Sending `message` results in every request silently falling through
  to Classify Intent's empty-string default and Get Embedding's hardcoded fallback text,
  returning the same canned delivery-time answer regardless of what was actually asked — no
  error, just a wrong-looking but "successful" response. The real chat widget must send the
  `question` key.
- Found and fixed a real classification gap: a complaint like "my order arrived cold... very
  late... very unhappy" matched no complaint keyword but did match the order-status keyword
  "my order", so it got routed to order-lookup instead of escalation. Expanded
  COMPLAINT_KEYWORDS (added unhappy, arrived cold, very late, angry, upset, frustrated, rude,
  damaged, broken, spoiled, horrible, etc.) — confirms the heuristic needs ongoing tuning as
  real phrasing surfaces gaps, exactly as flagged as an open item after Phase 2's first build.
- Gotcha hit while editing a Code node's JS directly in the n8n web editor via automated
  typing: the editor auto-closes brackets/quotes, so typing already-closed code (e.g. a
  trailing `}];`) produces duplicated stray closing tokens and a silent syntax error that only
  surfaces at execution time ("Unexpected token ')'"). Caught via the workflow's Executions
  tab (production runs don't show live on the canvas — only test-URL runs do). Always verify
  a hand-edited Code node against the Test URL before (re-)publishing to production.

Open items:
- Confirm WooCommerce order IDs match customer-facing order numbers (no custom order-number
  plugin) — order-lookup assumes they're the same.
- Product categories all show "Uncategorized" in WooCommerce — confirm if intentional
- Production webhook activation ("Publish"/Active toggle) didn't reliably work during
  testing — needs investigation before relying on it for a live frontend (the order-lookup
  sub-workflow sidesteps this for the chat-flow call path by using Execute Workflow instead of
  a second webhook, but the sub-workflow's own standalone webhook would still hit this if
  ever exposed directly to a frontend)
- Similarity threshold (0.2) untuned, needs revisiting with real usage data
- Intent classification heuristic (keyword/regex based) is untuned — no real traffic tested
  yet, may need keyword list expansion or a fallback LLM classifier if misclassification shows
  up
- Custom chat widget frontend not started
- Email escalation (Phase 3+?) — Escalation Stub is a placeholder canned reply only, no actual
  email is sent yet
- Phase 3+ scope not yet defined
