# Order Pilot — Operations

Durable operational knowledge for the Cociniña site and the Order Pilot agent.
Unlike the phase handoffs, **this file is not superseded each phase** — it is the
current reference for how the live systems are configured and where they bite.

If something here turns out to be wrong, fix it here rather than recording the
correction in a handoff. Handoffs describe *status*; this file describes *how
things work*.

Last verified: 2026-09-06.

---

## ⚠️ THE PUNYCODE RULE

**Anywhere an email address on this domain is stored or validated, use the
punycode form:**

```
dennishermoso@xn--cocinia-9za.com
```

The `ñ` form **fails silently** in both places it has been tried:

| Where | Failure |
|---|---|
| WP Mail SMTP username | `535 5.7.8 authentication failed` |
| WooCommerce email recipients | Saves as empty, no error shown |

Notes:

- Hostinger's UI displays the `ñ` version, which is misleading.
- The correct punycode is `xn--cocinia-9za.com`. It is **NOT**
  `xn--cocinia-o1a.com` — that was tried and is wrong.
- The `ñ` form **is** fine as a plain `To:` display address once saved.

This rule has cost time twice. It is the first thing to check when mail
mysteriously does not send or a recipient field appears to save as blank.

---

## WordPress email (WP Mail SMTP)

Working configuration, verified end to end:

| Setting | Value |
|---|---|
| Mailer | Other SMTP |
| Host | `smtp.hostinger.com` |
| Port | **465** |
| Encryption | **SSL** |
| Authentication | On |
| Username | the **punycode** address (see rule above) |
| Force From Email | On |
| Force From Name | On |
| Mailbox | `dennishermoso@cociniña.com` |

DNS: MX, SPF, DKIM and DMARC are all configured and verified green.

---

## Telegram alerting

| Item | Value |
|---|---|
| Bot | `@cocininaalertsbot` |
| Display name | Cociniña Alerts |
| Chat ID | `8910263889` |
| n8n credential | `Telegram - Cocinina Alerts` |

The credential name is deliberately ASCII: credential names appear in exported
workflow JSON and in `Select-String` output, and a `ñ` there is a nuisance.

**The bot token is NOT in the repo.** It is stored locally. To recover it:
BotFather → `/mybots` → select the bot → API Token.

### Live alerts

1. **Escalation email failure** — a Telegram node on a parallel branch off
   `Rebuild Failed Answer` in the RAG chat workflow. Fires only when the Gmail
   node errors. Verified both ways: fires on failure, silent on success.
2. **New WooCommerce order** — a separate workflow fed by a WooCommerce webhook.
   Verified with a real order.

### Gotchas

- **`getUpdates` returns `{"ok":true,"result":[]}`** even when
  `pending_update_count` is 1, once an earlier call has advanced the offset.
  Use **`getUpdates?offset=-1`** to retrieve the held update. Go straight to
  `offset=-1` rather than trying the bare call first.
- **Telegram's in-app search may not find `@BotFather`** on a fresh account. Use
  `https://t.me/BotFather` — and open it *inside Telegram*. Opening it from a
  Facebook/Messenger in-app browser wraps the URL in `l.facebook.com` and the
  hand-off fails.
- **Bot usernames are ASCII-only** and must end in `bot`. The `ñ` is fine in the
  *display name* only.
- **"Append n8n Attribution" is ON by default** and adds an italic footer. In the
  Telegram node it sits **below Additional Fields**, easy to miss below the fold.
  Toggle it off. Already-sent messages keep the footer.
- Executing a Telegram node in isolation with no input item does nothing and
  reports "No output data". That is not an error — there are simply no items to
  iterate.
- **Do not set a parse mode.** Plain text avoids breakage on customer messages
  containing `_` or `*`.

---

## WooCommerce webhook (new order alert)

WooCommerce → Settings → Advanced → Webhooks:

| Field | Value |
|---|---|
| Name | `Order Pilot - New Order Alert` |
| Status | **Active** |
| Topic | **Order created** |
| Delivery URL | `https://dmhermoso.cloud/webhook/new-order` |
| Secret | auto-generated (see caveat below) |
| API Version | **WP REST API Integration v3** |

### The ping payload

**WooCommerce sends a ping payload on webhook create/update.** This produced a
`NEW ORDER #unknown` alert with empty fields. `Format Order Alert` now guards
with:

```js
if (!order.id && !order.number) return [];
```

Returning `[]` means the Telegram node receives zero items and does not fire —
see the zero-items behaviour in `N8N_NOTES.md`.

### Why `order.created` and not `order.updated`

Chosen deliberately. With an online gateway, `order.created` can fire while the
status is still `pending` — the alert prints `Status:` so this is visible.

**There is no second alert when payment clears.** If pending-then-paid orders
prove common in practice, add a second webhook on `order.updated` with a status
filter rather than switching this one over.

### Signature verification — NOT implemented

WooCommerce generates a secret; **n8n ignores it**. Anyone who learns the URL can
push a fake order alert. Low stakes (a bogus Telegram message, no data exposure)
but trivially fixable with an HMAC check node. Open item.

### What the alert shows

- The **full unmasked delivery address** — you need it to deliver. This is
  deliberately different from the customer-facing order lookup, which masks the
  street (`•••`). Different audience, different rule.
- **Omits the country/state field**, which sidesteps the `00` state-code issue
  below.
- Prefers `shipping` over `billing` when shipping has a street.

---

## Order ID vs customer-facing order number

Verified three times, across #754, #769 and #771 (the last a real COD checkout
order): **all display as their API `number` field.** There is no custom
order-number plugin installed, so `id` and `number` do not diverge.

This means the order-lookup flow can rely on `number` as the customer-facing
identifier without a translation step. If a custom order-number plugin is ever
installed, this assumption breaks and the lookup needs revisiting.

---

## The `00` state code

`00` appears in customer-facing addresses. It is the WooCommerce state code for
Metro Manila. The fix belongs in `Verify & Build Response` in the order-lookup
workflow.

Sidestepped entirely in the Telegram new-order alert by omitting state.

---

## ⚠️ Intermittent WordPress admin CSS failure — UNRESOLVED

WP admin periodically renders as **unstyled HTML** — the menu tree appears as
plain links. Purging cache fixes it for a few minutes, then it returns.

Almost certainly LiteSpeed Cache CSS/JS combine-minify regenerating broken
output, but **this has not been diagnosed.**

**This has already blocked work once**, interrupting webhook configuration
mid-session. Expect it to keep biting until it is properly fixed.

### Next diagnostic step

While the admin is in the broken state, open F12 → Console + Network and check
whether the CSS requests:

- return 404,
- return the wrong MIME type, or
- are blocked outright.

That distinguishes a missing generated file from a server config problem.

### Pragmatic alternative

Turn off LiteSpeed's CSS/JS optimization entirely — Page Optimization → CSS/JS
Settings — and see whether the problem stops. Slower pages, but a working admin.

---

## ⚠️ Encoding hazards

Three distinct encoding failures have hit this project. All three produce output
that looks fine until it doesn't.

### 1. `Set-Content -Encoding utf8` writes a BOM

PowerShell 5.1's `utf8` encoding includes a byte-order mark. Use this instead:

```powershell
[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
```

Wrap the path in `Join-Path (Get-Location)` so it resolves predictably.

### 2. Console code-page round-trip destroys punctuation

Piping UTF-8 text through the console — for example
`git show <rev>:<file> > out.md` — can re-encode it through the console code
page. A UTF-8 em-dash (`E2 80 94`) becomes the three characters `ΓÇö`.

This is **invisible to a normal search**: the file is valid UTF-8, it just
contains the wrong characters. `Select-String` for the correct character finds
nothing, and the terminal may render the corruption differently depending on the
current output encoding — so *the console cannot be trusted to diagnose this*.

**Verify with bytes, not glyphs:**

```powershell
$b = [System.IO.File]::ReadAllBytes($path)
($b[0..40] | ForEach-Object { $_.ToString("X2") }) -join " "
```

Known mangled sequences and their true characters:

| Mangled | Real | Code point |
|---|---|---|
| `ΓåÆ` | → | U+2192 |
| `ΓåÉ` | ← | U+2190 |
| `ΓÇö` | — | U+2014 |
| `ΓÇô` | – | U+2013 |
| `ΓÇª` | … | U+2026 |
| `Γ£à` | ✅ | U+2705 |
| `Γï»` | ⚠ | U+26A0 |

When repairing, specify replacement characters by code point (`[char]0x2014`)
rather than typing them literally, so the fix itself cannot be mangled on the way
in.

### 3. A write can silently produce nothing

`docs/order-pilot-phase6-handoff.md` was committed as a **0-byte file** by
`eeeec34`, replacing 15KB of content written by `760d3ef`. It went through
`git add` and `git commit` unremarked and stayed empty for a week.

**Always verify a write actually produced bytes** before committing — a line
count, a `Test-Path`, or a `Select-String` for something unique to the change.
This is the same discipline the export-and-commit procedure already requires; it
applies to documentation too.

Recovery, if it happens again:

```powershell
git log --oneline --follow -- "<path>"
git cat-file -s (git rev-parse "<rev>:<path>")   # size in bytes at that rev
git show "<rev>:<path>"                          # the content
```

---

## Test orders

| Order | State |
|---|---|
| #754 | Zero-value. Leave in place. |
| #769 | ₱200 Chicken Curry, `hermosodennis2@gmail.com`. The good fixture. |
| #771 | ₱200 Lumpiang Shanghai, real COD checkout. Billing country wrongly says **Denmark** — the checkout dropdown was not changed during testing. A data error, not a bug. Trash it. |
| #768 | Half-built admin order. Trash it. |

Also worth checking: the WooCommerce **default checkout country**, which is what
let #771 end up as Denmark.

---

## Escalation email address

Hardcoded in **four places** plus two `sendTo` fields:

- `GENERIC_FAIL`
- `Escalation Stub`
- `Escalation Failed Response`
- the no-match response

All name `dennisphx18@gmail.com`. **Change them together** — a partial change
means some customer-facing text names an address that no longer receives mail.

⚠️ Testing the escalation *failure* path requires temporarily setting the Gmail
To field to an invalid address. **The correct value is `dennisphx18@gmail.com`.**
Write it down before breaking it, restore it afterwards, re-run a success test,
and grep the export for both the correct value and the broken one before
committing.
