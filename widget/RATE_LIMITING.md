# Rate Limiting Design — Phase 3

## Why IP-based, not sessionId-based

The widget's sessionId lives in the visitor's localStorage — trivial to reset (clear
storage, private window, or call the webhook directly with a fresh UUID). Fine for
conversation continuity, useless as an abuse gate. IP is the meaningful signal for
actual abuse.

Caveat: if dmhermoso.cloud sits behind a reverse proxy (nginx, Cloudflare, etc.), the
webhook node might see the proxy's IP for every request instead of the real visitor IP,
unless the proxy forwards it via X-Forwarded-For and n8n is configured to trust it.
Verify by sending test requests from two different networks and checking if the
captured IP differs.

### X-Forwarded-For is only trustworthy from the right

`X-Forwarded-For` is append-only: each proxy appends the address it received the request
from, on the **right**. Everything to the left of your own trusted hops is whatever the
*client* sent, and is therefore forgeable.

This makes the obvious `split(',')[0]` — the leftmost entry — exactly the wrong element
to read. An attacker who sends a random `X-Forwarded-For` on each request gets a fresh
counter bucket every time and is never limited, which defeats the entire mechanism. It
also has a second failure mode in the other direction: everyone behind one corporate NAT
or campus gateway collapses into a single bucket and throttles each other.

So: count from the right, skipping the number of proxies you actually control.

**Determine `TRUSTED_PROXY_HOPS` before relying on this.** Send a request with a junk
header from an external network:

```
curl -s -X POST https://dmhermoso.cloud/webhook/chat \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: 203.0.113.99" \
  -d '{"question":"test"}'
```

Then read the captured `x-forwarded-for` in that execution (n8n → Executions → the
webhook node's output). If it shows `203.0.113.99, <your real IP>`, one trusted proxy is
appending and `TRUSTED_PROXY_HOPS = 1`. If a CDN sits in front too, expect a third entry
and use `2`. If the junk value arrives alone and unmodified, nothing is appending it —
`X-Forwarded-For` is unusable here and the limiter must key on something else.

## 1. Table (run once in Supabase SQL editor)

```sql
CREATE TABLE IF NOT EXISTS rate_limits (
  identifier text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count int NOT NULL DEFAULT 1,
  PRIMARY KEY (identifier, window_start)
);
```

Also tracked as `migrations/001_rate_limits.sql` so it can be run directly.

## 2. New nodes at the start of the main chat workflow

Insert before the existing intent-classifier Code node — everything else stays as-is.

### Code node — "Compute Rate Limit Key"

```js
const windowMinutes = 10;
const limit = 20;

// How many proxies between the internet and n8n append to X-Forwarded-For.
// MUST be confirmed against a real request first -- see the section above.
// Too high and you read a forgeable client-supplied value; too low and you
// bucket every visitor under the proxy's own address.
const TRUSTED_PROXY_HOPS = 1;

// Read from the RIGHT: the rightmost entries were appended by infrastructure
// we control, everything further left came from the caller and is forgeable.
const xff = ($json.headers['x-forwarded-for'] || '')
  .split(',')
  .map((part) => part.trim())
  .filter(Boolean);

let ip =
  xff.length >= TRUSTED_PROXY_HOPS
    ? xff[xff.length - TRUSTED_PROXY_HOPS]
    : $json.headers['x-real-ip'] || '';

// This value originates from a caller-supplied header, so it is untrusted even
// after the positional check. Anything that isn't IP-shaped collapses to a
// single shared bucket rather than flowing onward.
if (!/^[0-9a-fA-F:.]{1,45}$/.test(ip)) ip = 'unknown';

const windowMs = windowMinutes * 60 * 1000;
const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs).toISOString();

return [{ json: { ...$json, rateLimitIp: ip, windowStart, limit } }];
```

(`limit = 20` = 20 messages per 10-minute window per IP — adjust as needed.)

### Postgres node — "Upsert Rate Limit" (Execute Query)

**Use query parameters, not `{{ }}` interpolation.** `rateLimitIp` derives from a header
the caller controls, so interpolating it into SQL text is an injection hole — and this
node runs as the Postgres role that bypasses RLS, so it reaches every table in the
database, `documents` included. A rate limiter that opens a path to `DROP TABLE` is worse
than no rate limiter.

Set the node's **Options → Query Parameters** to:

```
{{ $json.rateLimitIp }}, {{ $json.windowStart }}
```

and reference them positionally in the query, so the driver escapes the values:

```sql
INSERT INTO rate_limits (identifier, window_start, request_count)
VALUES ($1, $2, 1)
ON CONFLICT (identifier, window_start)
DO UPDATE SET request_count = rate_limits.request_count + 1
RETURNING request_count;
```

The regex check in the Code node is defence in depth, not the primary control — keep
both. Note this differs from the existing `Similarity Search` node, which also
interpolates but only ever inserts an embedding the workflow generated itself; that value
never crosses a trust boundary, whereas this one does.

### IF node — "Over Limit?"

Condition: `{{ $json.request_count }} > {{ $('Compute Rate Limit Key').item.json.limit }}`

- True branch → Respond to Webhook node with a friendly throttle message, using the
  same field name the existing success responses use so the widget's responseFields
  parsing picks it up without changes — e.g.
  `{"answer": "You're sending messages a little fast — please wait a few minutes and
  try again, or email us directly."}`
  This branch ends the workflow here, before any LLM/embedding calls, so no cost is
  incurred.
- False branch → continue into the existing intent-classifier node, unchanged.

## 3. Optional cleanup

Daily scheduled workflow:

```sql
DELETE FROM rate_limits WHERE window_start < now() - interval '2 days';
```

Not urgent — table grows slowly at 10-minute windows.

## Status

Design only — not yet implemented in the live n8n workflow. Requires manual work in
the n8n browser UI (add 3 nodes) and running the CREATE TABLE statement in the
Supabase SQL editor. Neither of those can be done from this repo/CLI.

Before implementing, in order:

1. Run `migrations/001_rate_limits.sql` in the Supabase SQL editor.
2. Confirm `TRUSTED_PROXY_HOPS` against a real request (see above). Do not skip this —
   the wrong value silently makes the limiter either bypassable or overly aggressive,
   and neither shows up as an error.
3. Add the three nodes, using **Query Parameters** on the Postgres node.
4. Verify against the Test URL before republishing — per the Phase 2 note, hand-editing
   Code nodes in the n8n editor can silently duplicate auto-closed brackets, and
   production runs don't surface on the canvas.
5. Sanity-check both directions: normal traffic still gets through, and exceeding the
   limit returns the throttle message without an embedding or Claude call (confirm via
   the execution log, not just the reply text).
