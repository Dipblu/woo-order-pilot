# Porting Order Pilot to a new site

**Status: skeleton.** Phase 10 turns this into a full decision tree. Until
then this is the collection point for portability knowledge — it lives here
rather than in a handoff so it doesn't get superseded and lost.

Deployment model: **clone-per-client, not multi-tenant.** Copy the workflows,
swap the Config nodes, point at a fresh Supabase project.

---

## Step zero: freshness gate

Everything downstream reads the exported JSON. A stale export means porting
nodes as they aren't.

1. Export **both** workflows — `rag-chat-workflow.json` AND
   `order-lookup-workflow.json`. The sub-workflow is the one that gets
   forgotten; it sat 3 weeks stale in the repo on 2026-09-19 and nothing
   caught it.
2. Close the browser tab before downloading.
3. Confirm the export timestamp is newer than your last edit. Byte count
   alone is not enough — it proves *something* changed, not that the *right*
   thing did.
4. Run `npm run test:intent-sync`.

The drift guard only covers `intent.ts`. It has nothing to say about either
workflow JSON.

---

## DO NOT PORT

Deployment-specific values that must never carry over to a client:

- Personal Gmail address (`dennisphx18@gmail.com`) — now in Config nodes in
  both workflows, but check for stragglers
- Telegram chat ID `8910263889` (in `Send a text message`)
- Food vocabulary in `COMPLAINT_KEYWORDS` — "cold food", "arrived cold",
  "spoiled"
- Quantity-unit regex — servings, pax, plates, bowls, kilos
- Brand persona and tone
- `faqs.json` — replaced wholesale per client
- `Asia/Manila` timezone
- **Contact details in the knowledge base.** The `Ask Claude` system prompt
  contains no email and no Facebook URL, but live answers have returned both
  — they come from retrieved context, i.e. `faqs.json` / the `documents`
  table. Less severe than a prompt leak since KB content is replaced per
  client, but it must be checked.

---

## Rewrite, don't reconfigure

These need new content written, not values swapped. Do not parameterise them
into Config — splicing in `${businessName}` creates false confidence that one
swap suffices.

**`Ask Claude` system prompt** — two of six instructions are site-specific:

| Line | Nature |
|---|---|
| "customer support assistant for an online food delivery store" | **rewrite** |
| "Answer using ONLY the context below… say you're not sure" | keeper (core RAG discipline) |
| "Be concise and friendly" | keeper |
| "Do not claim any **dish** is popular, a best seller, or a customer favorite" | **rewrite** |
| "Present recommendations as suggestions only" | keeper |
| "Respond in plain text… no markdown" | keeper (widget markdown fix) |

Also needing rewrites: complaint keywords, quantity-unit regex, decline
phrases used by `Detect Low-Confidence Answer`.

**Similarity thresholds** - the same problem as decline phrases, one layer
down. `0.2` in `Check Relevance` and `0.5` in `Should Log Low Confidence?`
were both tuned by eye against `text-embedding-3-small` and this corpus.
A different embedding model or a different knowledge base moves the bands
and nothing fails loudly: retrieval keeps working, it just starts answering
questions it should decline or declining ones it could answer. Budget an
afternoon of watching `unanswered_questions` on a new deployment before
trusting either number. Details and observed ranges in `TESTING.md`.

**Telegram parse mode** (weekly digest) - the n8n Telegram node defaults to
Markdown when Parse Mode is unset, and the dropdown offers no "None". Customer
question text goes into that message verbatim, so an underscore in
`low_confidence_answer` was enough to make Telegram reject the whole send
with `can't parse entities`. Current setting is HTML, paired with
`&`/`<`/`>` escaping inside the digest SQL. **The parse mode and the
escaping are one decision, not two** - swapping the digest to Slack or email
means undoing both, and swapping to MarkdownV2 means escaping about eighteen
characters instead of three.

---

## The config layer

Both workflows have their own `Config` Set node (Manual Mapping, Include
Other Input Fields = All). Six string keys each:

`escalationEmail`, `fromEmail`, `contactEmail`, `contactFacebook`,
`businessName`, `timezone`

**Sub-workflows need their own Config node.** Sub-workflows only see passed
input, so the parent's Config is unreachable. Proven, not just decided —
`order-lookup-workflow.json` has its own, placed between `Normalize Input`
and `Get Order` (the junction where both entry points converge).

### Config has a silent-failure mode — verify from JSON

An n8n expression field only evaluates if its stored value starts with `=`.
The `fx` toggle showing as active in the UI does **not** guarantee the prefix
was stored; editing an existing expression field can drop it. A field without
it holds the literal text `{{ ... }}` and fails only at runtime.

On 2026-09-19, two of the five Config consumers were wrong this way. The
complaint escalation branch had not sent an email since the Config node was
added, and nothing surfaced it because `Escalation Failed Response` degrades
gracefully. A missing `=` on `fromEmail` was even less visible: the send
succeeded because Gmail substitutes the authenticated account.

So after any Config rewire, check the exported JSON rather than the UI:

node -e "const wf=require('./n8n/rag-chat-workflow.json');for(const n of wf.nodes){for(const [k,v] of Object.entries(n.parameters||{})){if(typeof v==='string'&&v.includes('{{')&&!v.startsWith('=')){console.log('MISSING =',n.name,'|',k,'|',v)}}}"

No output means clean. Run the equivalent against
`order-lookup-workflow.json` too.

---

## Honest scope note

The Config nodes cover roughly **six of ~65 porting items**. Credentials,
instance IDs and webhook IDs are set per-instance in n8n's UI regardless.
Domain logic needs rewriting, not reconfiguring. Do not later assume "the
Config node handles deployment."

**Realistic effort:** another WooCommerce food/retail store — half a day. An
arbitrary business — about two days, because intent classification needs new
keywords and the commerce module needs replacing or removing.

---

## Decision tree (Phase 10 — in progress)

Q: Does this site have orders a customer can look up by number?
NO → delete: Is Order Query?, Have Order Info?, Save Pending Intent,
Ask For Order Info, Execute Order Lookup, Clear Pending Intent,
Format Order Response
→ delete the order-lookup sub-workflow
→ drop pending_intents (session state becomes unused)
→ ORDER_KEYWORDS becomes dead; strip from intent.ts
→ ~30 of 85 test cases become irrelevant; list them
YES, WooCommerce → keep as-is, change credentials only
YES, other platform → keep the shape, rewrite Execute Order Lookup's HTTP
node; verify order ID == customer-facing number for that platform

Remaining questions to work out: escalation channel, rate limiting, widget
embed, knowledge base, intent vocabulary.
