# Rate Limiting Design — Phase 3

## Why IP-based, not sessionId-based

The widget's sessionId lives in the visitor's localStorage — trivial to reset (clear
storage, private window, or call the webhook directly with a fresh UUID). Fine for
conversation continuity, useless as an abuse gate. IP is the meaningful signal for
actual abuse.

### Which header to trust (confirmed against a live execution)

dmhermoso.cloud sits behind nginx, and its behaviour has been verified directly from an
n8n execution rather than assumed:

- **`x-real-ip` is set by nginx to the actual visitor IP.** It is not client-controlled —
  nginx overwrites whatever the caller sends. This is the primary source.
- **`x-forwarded-for` has the real visitor IP appended on the right** by nginx, as
  expected for an append-only forwarding header.

So the limiter reads `x-real-ip` first: it's a single value with no parsing, and nginx
replaces rather than appends it, which removes a whole class of ordering mistakes.

`x-forwarded-for` remains only as a fallback for the case where `x-real-ip` is somehow
absent — and when used, it must be read from the **right**. The header is append-only:
each proxy appends the address it received the request from, so the rightmost entry is
the one nginx wrote and everything to its left is caller-supplied and forgeable. Reading
the obvious `split(',')[0]` would take exactly the forgeable element, letting an attacker
rotate the header per request for a fresh counter bucket every time and bypass the
limiter entirely.

Either way the chosen value is validated before use — see the Code node below.

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

// nginx sets x-real-ip to the actual visitor IP and overwrites whatever the
// caller sent, so it is the primary source -- confirmed against a live n8n
// execution.
let ip = ($json.headers['x-real-ip'] || '').trim();

// Fallback only if x-real-ip is missing. x-forwarded-for is append-only, so
// take the RIGHTMOST entry: that's the one nginx wrote. Everything to its left
// is caller-supplied and forgeable.
if (!ip) {
  const xff = ($json.headers['x-forwarded-for'] || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  ip = xff.length ? xff[xff.length - 1] : '';
}

// Applies to whichever source was used. Anything not IP-shaped collapses to a
// single shared bucket rather than flowing onward into the query.
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
2. Add the three nodes, using **Query Parameters** on the Postgres node. (Header
   handling is already settled — `x-real-ip` is confirmed to carry the real visitor IP.)
3. Verify against the Test URL before republishing — per the Phase 2 note, hand-editing
   Code nodes in the n8n editor can silently duplicate auto-closed brackets, and
   production runs don't surface on the canvas.
4. Sanity-check both directions: normal traffic still gets through, and exceeding the
   limit returns the throttle message without an embedding or Claude call (confirm via
   the execution log, not just the reply text).
