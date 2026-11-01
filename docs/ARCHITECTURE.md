# Architecture

HookBox is one TypeScript Worker and one React SPA, deployed together. This document describes the
runtime paths, the modules and the decisions behind them.

## Deployment shape

```
Cloudflare Pages (advanced mode)            Cloudflare Workers (alternative)
  dist/  → static assets                     npm run deploy (wrangler.jsonc)
  dist/_worker.js → same bundle              same bundle, ASSETS binding
                    │
                    ├── D1 database (inboxes, requests, rate_limits)
                    └── Server-Sent Events (per connected viewer)
```

Both targets run `worker/index.ts`. Pages serves the build output with an `_worker.js` in advanced
mode; Workers serves `dist/` through an `ASSETS` binding with `run_worker_first` limited to `/api/*`
and `/hook/*`. The SPA and the API therefore share an origin in both cases — no CORS, no cookies, no
second deploy target to keep in sync.

## Request routing

`worker/index.ts` is a hand-written router (~200 lines) with three entry points:

| Path                   | Handler                                                   |
| ---------------------- | --------------------------------------------------------- |
| `/api/*`               | `handleApi` → route table (regex + method) → route module |
| `/hook/:inboxId[/...]` | `handleWebhook` (public, CORS `*`)                        |
| everything else        | static asset fetch (SPA fallback handled by the platform) |

Errors are thrown as `HttpError` and converted by `errorResponse`, so every failure produces the same
`{ error: { code, message, retryAfterMs? } }` shape. Unexpected errors are logged as a single line
without request data and returned generically as `internal_error`.

All API responses carry `cache-control: no-store`, `x-content-type-options: nosniff` and
`referrer-policy: no-referrer`; HTML responses additionally get a CSP, `X-Frame-Options: DENY` and a
`permissions-policy`.

## Webhook receive path (hot path)

```
POST /hook/:id?query
  ├─ 1. resolve inbox (D1 read)             → 404 / 410 when missing or expired
  ├─ 2. rate limit: inbox+IP, then IP        → 429 + retry-after
  ├─ 3. request-count cap (500)              → 429 inbox_full
  ├─ 4. declared content-length check        → 429 inbox_storage_full
  ├─ 5. stream body with a 256 KiB ceiling   → 413 payload_too_large
  ├─ 6. classify + decode body               → json / xml / form / multipart / text / binary
  ├─ 7. persist request + bump counters      → one D1 batch (transaction)
  └─ 8. 200 JSON acknowledgement
```

Design choices:

- **Streaming size limit.** `readBodyLimited` reads chunks and aborts as soon as the ceiling is
  crossed, so an oversized upload is never buffered in memory. The declared `content-length` is
  checked before reading anything.
- **One transaction per request.** The insert plus the `request_count`/`storage_bytes` update run in a
  single `db.batch()` — two writes, one round trip, atomic counters.
- **No body decoding for binary.** `TextDecoder` is only used for bodies whose content type is textual
  or whose bytes are valid UTF-8; everything else is stored as base64 and rendered as a hex preview.
- **Rate limits in D1.** A fixed-window counter (`rate_limits` table) survives Worker restarts, is
  shared across regions and costs one write per hit. In-memory counters would be cheaper but wrong
  under load balancing.

## Inspect path

`GET /api/inboxes/:id/requests` builds SQL dynamically from safe, whitelisted filters:

| Filter                | SQL                                                              |
| --------------------- | ---------------------------------------------------------------- |
| `method` (repeatable) | `method IN (?, ...)`                                             |
| `contentType`         | `body_kind = ?`                                                  |
| `path`                | `path LIKE ? ESCAPE '\'`                                         |
| `q`                   | `(path LIKE ? OR IFNULL(body_text,'') LIKE ? OR headers LIKE ?)` |
| `since` / `until`     | `received_at >= ?` / `<= ?`                                      |
| `cursor`              | `(received_at < ? OR (received_at = ? AND id < ?))`              |

`LIKE` wildcards in user input are escaped. Every query is scoped by `inbox_id`, and the page size is
clamped to 100. `total` and `filtered` counts come from two small aggregate queries so the UI can show
"12 of 480" without a second round trip.

Detail responses are built by `toRequestDetail(row, { reveal })`: raw values are only serialised when
`reveal` is true, otherwise headers, query values and body fields go through the redaction layer. The
same flag drives the JSON export.

## Realtime: SSE with a bounded connection

Cloudflare Workers can stream a response, but keeping a connection open forever is a bad idea (cost,
idle timeouts, D1 polling). The stream therefore:

1. authenticates like every other API call (token in the `Authorization` header — not a query string,
   so it never lands in logs or referrers),
2. sends `hello` with the server time and the caller's cursor,
3. polls D1 every 1.2 s for rows newer than the compound cursor `(received_at, id)`,
4. sends a heartbeat every ~10 s,
5. closes after 25 s; the browser reconnects immediately with the last cursor.

The client falls back to a 4 s polling loop after three consecutive stream failures and labels the
state in the status bar (`Live · SSE`, `Polling · 4s`, `Offline`).

## Replay

```
targetUrl
  ├─ parse + scheme + credentials + hostname allowlist
  ├─ port 80/443 only
  ├─ DoH resolve (Cloudflare, Google) → every A/AAAA record checked
  ├─ fetch(redirect: 'manual', timeout 10s)
  ├─ 3xx → resolve Location → validate again (max 3 hops)
  └─ response status/headers/body preview (4 KiB cap)
```

Header handling is conservative: hop-by-hop headers and Cloudflare-injected headers are dropped;
credential headers are only forwarded when the user explicitly opts in. The replay body is capped at
64 KiB and the whole operation is limited to 10 calls/minute per inbox.

Cloudflare Workers cannot pin a resolved IP for an outbound `fetch`, so the DNS check is advisory with
respect to rebinding. This is documented as a residual risk in [SECURITY.md](SECURITY.md) and mitigated
by restricting ports and blocking metadata addresses.

## Cleanup

Two triggers share `sweepExpired`:

1. **Cron** — `triggers.crons = ["*/5 * * * *"]` when the account has a free slot.
2. **Request path** — every `/api/*` response schedules `maybeSweep` via `ctx.waitUntil`; a D1
   rate-limit row throttles it to one real sweep per minute.

A sweep selects up to 50 expired or deleted inboxes, deletes their requests and rows in a transaction,
and prunes rate-limit windows older than three hours. Expired inboxes already answer `410` before the
sweep runs, so correctness never depends on sweep timing.

## Frontend

- `src/App.tsx` owns the session: saved inboxes (localStorage), current inbox, filters, selection,
  dialogs and toasts.
- `src/hooks/useRequests.ts` owns the request list: initial page load, cursor pagination, SSE merge
  with deduplication, pending-count for arrivals hidden by an active filter, and polling fallback.
- Detail data is fetched per selection (`?reveal=1` when the user opts in) so raw payloads are never
  prefetched.
- Layout is a two-pane workspace on desktop and a list → detail flow below 768 px; the detail sheet has
  an explicit back control and the page must not scroll horizontally.
- Styling: Tailwind CSS 4 with a small custom theme (dark developer console), lucide icons, no UI kit.

## Build and deploy pipeline

```
npm run build            → tsc --noEmit (app) + vite build → dist/
node scripts/build-pages → vite build + esbuild worker → dist/_worker.js
node scripts/deploy-pages → Pages project + D1 binding + AUTH_PEPPER + upload
npm run deploy           → vite build + wrangler deploy
```

`scripts/verify-live.mjs` drives the deployed site with 22 real HTTP checks; `scripts/screenshots.mjs`
produces the README images from the live product.

## Performance notes

- Static assets are served by the platform edge, not the Worker (except under Pages advanced mode,
  where `_worker.js` decides — it returns assets through the binding without touching D1).
- The webhook path performs one read, two rate-limit writes and one request write; a typical payload
  stays far below the free plan's 10 ms CPU budget per invocation.
- The list endpoint is index-backed except for keyword search, which scans at most one inbox (≤ 500
  rows).
- The SPA bundle is ~300 KiB raw / ~85 KiB gzipped plus a 41 KiB stylesheet.
