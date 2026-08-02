# Order Pilot — Chat Widget (Phase 3)

Embeddable AI support chat widget for the WooCommerce food delivery store. Vanilla JS,
zero dependencies, renders inside a Shadow DOM so it can't collide with the site's
existing CSS/JS and the site's CSS can't leak in and break the widget.

## Files

- `order-pilot-widget.js` — the whole widget. One file, drop it anywhere.
- `demo.html` — local preview page wired to the production webhook, for testing before embedding.

Serve the demo over HTTP rather than opening it as a `file://` URL, so the browser sends a
real `Origin` and CORS is actually exercised:

```
cd widget && python -m http.server 8899 --bind 127.0.0.1
# then open http://127.0.0.1:8899/demo.html
```

## Quick embed

Add this before `</body>` (or via a "Custom HTML"/"Insert Headers and Footers" block in
WordPress — see WooCommerce section below):

```html
<script
  src="/path/to/order-pilot-widget.js"
  data-webhook-url="https://dmhermoso.cloud/webhook/chat"
  data-business-name="Your Store Name"
  async>
</script>
```

That's it — a chat launcher appears bottom-right on every page that includes the script.

## Config options

All options can be set either as `data-*` attributes on the script tag (kebab-case) or
via a `window.OrderPilotConfig` object declared *before* the script tag loads (camelCase).
The `window.OrderPilotConfig` form is useful if you want to keep the script tag itself
clean, or set values dynamically from WordPress PHP.

| Option | data-attribute | Default | Notes |
|---|---|---|---|
| `webhookUrl` | `data-webhook-url` | `https://dmhermoso.cloud/webhook/chat` | Main chat production webhook |
| `businessName` | `data-business-name` | `"Support"` | Shown in the panel header |
| `welcomeMessage` | `data-welcome-message` | generic greeting | First bot message shown on a fresh session |
| `launcherLabel` | `data-launcher-label` | `"Chat with us"` | Text on the floating button |
| `position` | `data-position` | `"right"` | `"right"` or `"left"` |
| `accentColor` | `data-accent-color` | `#C1440E` | Primary accent (buttons, user-message border) |
| `accentColorDark` | `data-accent-color-dark` | `#9A3609` | Hover/active shade of accent |

Example using the JS object form:

```html
<script>
  window.OrderPilotConfig = {
    webhookUrl: "https://dmhermoso.cloud/webhook/chat",
    businessName: "Manila Bites",
    accentColor: "#E4572E",
    welcomeMessage: "Hey! Order status, menu questions, or a complaint — what's up?"
  };
</script>
<script src="/path/to/order-pilot-widget.js" async></script>
```

## Embedding in WooCommerce / WordPress

Pick whichever fits the current setup best:

1. **Theme footer (no plugin):** Appearance → Theme File Editor → `footer.php`, paste the
   script tag right before `</body>`. Simplest, but gets wiped on theme updates unless
   using a child theme.
2. **"Insert Headers and Footers" type plugin:** paste the script tag into the site-wide
   footer field. Survives theme updates, no code editing.
3. **Site-wide via a snippet plugin (e.g. WPCode):** same idea, adds versioning/rollback.

Any of these load the widget globally. There's no per-page WooCommerce hook needed since
the widget is a fixed-position overlay, not tied to page content.

## Programmatic control (optional)

The widget exposes `window.OrderPilot` after it loads, in case a "Track your order" button
elsewhere on the site should open the chat directly:

```js
window.OrderPilot.open();                       // opens the panel
window.OrderPilot.close();                       // closes it
window.OrderPilot.reset();                       // clears history + starts a new session
window.OrderPilot.sendMessage("Where's my order?"); // opens + sends a message immediately
```

## How it talks to the backend

On send, the widget does:

```
POST {webhookUrl}
Content-Type: application/json

{ "question": "<user's message text>", "sessionId": "<persisted per-browser UUID>" }
```

**The response is a JSON array, not an object.** Verified against production on
2026-08-02 — the `Respond to Webhook` node is set to `allIncomingItems`, so a successful
call returns:

```json
[{"answer": "We're open daily from 10 AM to 7 PM..."}]
```

The widget's `extractReplyText()` unwraps the array and then reads `answer` (it also
tries `output`, `response`, `message`, `text`, `reply` as fallbacks in case the workflow
changes, and treats a non-JSON body as plain text). If nothing matches it shows a generic
"couldn't read that" message rather than a blank bubble. Note that the request still
returns HTTP 200 in that case, so a parsing regression fails *silently* — if replies ever
start coming back as the fallback text, check the response shape first.

Conversation history and the session UUID persist in the browser's `localStorage` per
visitor, so a page refresh doesn't lose the thread. History is capped at the last 50
messages. **This is display-only** — see below.

## Verified backend behaviour (checked against production, 2026-08-02)

These were previously listed as unverified assumptions. All three have now been probed
directly against `https://dmhermoso.cloud/webhook/chat`:

1. **Response field name — confirmed, with a catch.** Field is `answer`, but wrapped in
   an array (see above). Code written against `data.answer` would silently render nothing.
2. **`sessionId` is ignored by the backend — there is no server-side memory.** The
   workflow reads only `body.question` and classifies each message independently; there is
   no memory node or state store anywhere in either workflow. Proven live: sending an order
   number + email in one message returned the correct order, then asking "what is the status
   of my order?" on the *same* sessionId came back with "could you share your order number
   and the email address...". The widget still sends `sessionId` (useful for future logging
   or a real memory implementation), but it buys nothing today.

   Because of this, the widget does **client-side slot filling** for order lookups: it
   remembers an order number/email the visitor typed earlier in the session and merges them
   into a single well-formed question, because that single-message shape is the only one
   the workflow can actually resolve. Without it, the natural exchange
   "where is my order?" → "754" dead-ends: a bare number matches no order keyword, falls
   through to the RAG path, and returns "I'm not able to find information about that."
   This is the only state the widget infers — it is not general conversation memory, and
   the visible history is not sent to the backend.
3. **CORS already works — no n8n change needed.** The webhook node has no explicit
   `allowedOrigins` set, and n8n's default is to allow all origins and reflect the caller's
   `Origin` back. Verified: `OPTIONS` preflight returns `204` with
   `Access-Control-Allow-Origin` echoing the caller, `Access-Control-Allow-Methods:
   OPTIONS, POST`, `Access-Control-Allow-Headers: content-type`. Confirmed for both an
   arbitrary origin and the real store origin `https://xn--cocinia-9za.com`. A browser
   `fetch` from the live store works as-is.

   ⚠️ The flip side: the endpoint accepts requests from **any** origin, with no API key and
   no rate limiting. Once this script is on a public page the webhook URL is trivially
   discoverable, and every POST costs an OpenAI embedding call plus (on the FAQ path) a
   Claude call. Address this before going live — see PROJECT_NOTES.md open items.

Still carried over from Phase 2: WooCommerce order IDs are assumed to equal customer-facing
order numbers. The widget is just a front end for the same order-lookup logic, so that
assumption applies here too.

## Tested end-to-end (2026-08-02)

Served over `http://127.0.0.1:8899` (a real HTTP origin, so CORS is genuinely exercised —
`file://` would not be representative) against the **production** webhook:

| Scenario | Result |
|---|---|
| FAQ — "What are your delivery hours?" | Grounded answer from the knowledge base |
| FAQ — "Do you have any spicy dishes?" | Correct product answer (Sweet and Spicy Laing, Sizzling Sisig) |
| Order status — number + email in one message | Full order summary for #754 |
| Order status — "where is my order?" → "754" → email | Resolves correctly via client-side slot filling |
| Complaint — "arrived cold... want a refund" | Routed to the escalation reply |

## Known cosmetic issue

Claude's answers sometimes come back containing markdown (e.g. `**Sweet and Spicy Laing**`).
The widget renders message text via `textContent` for XSS safety, so the asterisks show
literally. Fixing this properly means either constraining the system prompt to plain text
or adding a small, strictly-allowlisted markdown renderer — do not switch the bubble to
`innerHTML`, since the response text originates from an LLM.

## Not yet built (future phases, per the original phase plan)

- Complaint/escalation email confirmation UI (currently just relays whatever text the
  backend returns for an escalated complaint — no distinct "we've notified a human" visual
  treatment).
- Rate limiting / abuse protection on the front end (currently only disables the send
  button while a request is in flight).
- Analytics/logging hook.
