# API reference

Base URL: `https://hookbox.pages.dev` (or your own deployment).

All `/api/*` endpoints return JSON and require:

```http
Authorization: Bearer <inbox token>
```

Responses set `cache-control: no-store`, `x-content-type-options: nosniff` and
`referrer-policy: no-referrer`.

Error shape:

```json
{ "error": { "code": "invalid_token", "message": "Inbox token is not valid" } }
```

Rate-limited responses add `retry-after` (seconds) and `retryAfterMs` in the body.

## Create an inbox

```http
POST /api/inboxes
Content-Type: application/json

{ "ttlHours": 1, "label": "stripe-orders" }
```

`ttlHours` must be `1`, `6` or `24` (default `1`); `label` is optional (≤ 48 chars).

`201 Created`:

```json
{
  "inbox": {
    "id": "3Eoi23k-PHjbsHpu",
    "label": "stripe-orders",
    "createdAt": 1793498420482,
    "expiresAt": 1793502020482,
    "status": "active",
    "requestCount": 0,
    "storageBytes": 0,
    "webhookUrl": "https://hookbox.pages.dev/hook/3Eoi23k-PHjbsHpu"
  },
  "token": "Zq3…43 chars"
}
```

The token is returned **once**. Store it; the server keeps only its HMAC.

Errors: `400 invalid_ttl`, `400 invalid_label`, `429 rate_limited`, `429 inbox_quota_exceeded`.

## Read an inbox

```bash
curl https://hookbox.pages.dev/api/inboxes/$ID -H "Authorization: Bearer $TOKEN"
```

Returns `{ "inbox": { … } }`. `status` is `active`, `expired` or `deleted`; expired and deleted inboxes
answer `410`, unknown ids `404`, bad tokens `401`.

## Extend an inbox

```http
POST /api/inboxes/:id/extend
{ "hours": 6 }
```

`200` returns the updated inbox plus `extendedByMs` and `cappedAt`. The server caps the total lifetime
at 24 h from creation; beyond that it answers `409 ttl_capped`.

## Delete an inbox

```bash
curl -X DELETE https://hookbox.pages.dev/api/inboxes/$ID -H "Authorization: Bearer $TOKEN"
```

`{ "ok": true, "deleted": "<id>", "requests": 12 }` — the inbox, its token hash and all requests are
removed immediately.

## Receive a webhook (public)

Any method, any sub-path, optional query string. No authentication.

```bash
curl -X POST 'https://hookbox.pages.dev/hook/$ID?source=cli&tag=a&tag=b' \
  -H 'content-type: application/json' \
  -H 'x-custom: hello' \
  -d '{"event":"order.paid","amount":4200}'
```

`200`:

```json
{
  "ok": true,
  "id": "YtuIWzfJoQPc",
  "inbox": "3Eoi23k-PHjbsHpu",
  "method": "POST",
  "path": "/hook/3Eoi23k-PHjbsHpu",
  "bodyKind": "json",
  "bodyBytes": 58,
  "receivedAt": 1793498500000,
  "note": "Stored. Inspect it in your HookBox inbox."
}
```

Status codes: `200` stored, `404` unknown inbox, `410` expired/deleted, `413` body above 256 KiB,
`429` rate limit or inbox cap, `400` malformed URL. CORS is `*` so browser-based senders work too.

## List requests

```http
GET /api/inboxes/:id/requests?method=POST&method=PUT&contentType=json&q=order&since=1793490000000&limit=50
```

| Parameter         | Notes                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| `method`          | repeatable, one of GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS                |
| `contentType`     | body kind: `empty`, `json`, `xml`, `form`, `multipart`, `text`, `binary` |
| `path`            | substring match on the stored path                                       |
| `q`               | substring match over path, headers and body                              |
| `since` / `until` | epoch milliseconds                                                       |
| `cursor`          | opaque cursor from a previous page                                       |
| `limit`           | 1–100, default 50                                                        |

Response:

```json
{
  "requests": [
    {
      "id": "YtuIWzfJoQPc",
      "method": "POST",
      "path": "/hook/3Eoi23k-PHjbsHpu",
      "receivedAt": 1793498500000,
      "bodyKind": "json",
      "bodySize": 58,
      "contentType": "application/json",
      "statusCode": 200,
      "queryPairCount": 3,
      "headerPairCount": 12
    }
  ],
  "nextCursor": "MTc5MzQ5ODUwMDAwMDpZdHVJV3pmSm9RUGM",
  "total": 480,
  "filtered": 1
}
```

## Get one request

```http
GET /api/inboxes/:id/requests/:rid          # redacted
GET /api/inboxes/:id/requests/:rid?reveal=1 # raw
```

```json
{
  "request": {
    "id": "YtuIWzfJoQPc",
    "method": "POST",
    "path": "/hook/3Eoi23k-PHjbsHpu",
    "receivedAt": 1793498500000,
    "bodyKind": "json",
    "bodySize": 58,
    "contentType": "application/json",
    "statusCode": 200,
    "queryPairCount": 3,
    "headerPairCount": 12,
    "query": [
      ["source", "cli"],
      ["tag", "a"],
      ["tag", "b"]
    ],
    "headers": [
      ["content-type", "application/json"],
      ["authorization", "••••••"]
    ],
    "body": {
      "kind": "json",
      "text": "{\"event\":\"order.paid\",\"amount\":4200}",
      "size": 58,
      "truncated": false,
      "redacted": true
    },
    "sourceIp": "3fa9c1b2d4e5f607",
    "userAgent": "curl/8.7.1",
    "revealed": false,
    "completed": true
  }
}
```

`sourceIp` is a truncated HMAC of the client IP, never the raw value. Binary bodies expose `base64`
only when `reveal=1`, plus a `hexPreview`.

## Delete requests

```http
DELETE /api/inboxes/:id/requests/:rid   → { "ok": true, "deleted": "<rid>" }
DELETE /api/inboxes/:id/requests        → { "ok": true, "deleted": 12 }
```

## Replay

```http
POST /api/inboxes/:id/requests/:rid/replay
{ "targetUrl": "https://api.example.com/webhooks/test", "includeSensitiveHeaders": false }
```

`200`:

```json
{
  "replay": {
    "status": 200,
    "statusText": "OK",
    "durationMs": 137,
    "hops": 0,
    "finalUrl": "https://api.example.com/webhooks/test",
    "requestHeaders": [
      ["accept", "*/*"],
      ["x-hookbox-replay", "1"]
    ],
    "responseHeaders": [["content-type", "application/json"]],
    "bodyPreview": "{\"ok\":true}",
    "bodyPreviewTruncated": false,
    "bodyBytes": 11
  }
}
```

Blocked targets return `400` with one of: `invalid_target_url`, `blocked_scheme`,
`blocked_credentials`, `blocked_host`, `blocked_port`, `blocked_address`, `unresolvable_target`.
Other failures: `429 rate_limited`, `502 replay_failed`, `502 too_many_redirects`.

The replay endpoint is **not** a proxy: only the stored request is replayed, the body is capped at
64 KiB, the target must be public HTTP(S) on port 80/443 and every redirect hop is re-validated.

## Export

```http
GET /api/inboxes/:id/export           # redacted
GET /api/inboxes/:id/export?reveal=1  # raw
```

Returns a `hookbox-json` document with the inbox, every request (up to 100 per call), an export
timestamp and a warning field. The UI downloads it as a file after an explicit confirmation.

## Stream (SSE)

```http
GET /api/inboxes/:id/stream?cursor=MTc5MzQ5ODUwMDAwMDpZdHVJV3pmSm9RUGM
Accept: text/event-stream
```

Events:

```
event: hello
data: {"inboxId":"…","serverTime":1793498500000,"cursor":"…","pollIntervalMs":1200}

event: requests
data: {"requests":[{…}],"cursor":"…"}

event: ping
data: {"t":1793498600000}

event: stream-error
data: {"message":"Live updates stopped; reconnecting…"}
```

The stream closes after 25 s by design; reconnect with the last `cursor` to continue. Authenticate with
the `Authorization` header (EventSource cannot send headers — use `fetch` + `ReadableStream`, as the
bundled client does).

## Meta and health

```http
GET /api/health → { "ok": true, "name": "HookBox", "version": "1.0.0", "serverTime": 1793498400000 }

GET /api/meta   → { "name", "version", "serverTime", "limits": {…}, "features": {…} }
```

`limits` is the authoritative source for the numbers shown in the UI (body cap, request cap, TTLs,
rate limits, page size).

## Quick recipes

```bash
# Create + capture the token with jq
INBOX=$(curl -s -X POST https://hookbox.pages.dev/api/inboxes \
  -H 'content-type: application/json' -d '{"ttlHours":1}')
ID=$(echo "$INBOX" | jq -r .inbox.id)
TOKEN=$(echo "$INBOX" | jq -r .token)

# Send traffic
curl -s -X POST "https://hookbox.pages.dev/hook/$ID" -H 'content-type: application/json' -d '{"a":1}'

# Read it back
curl -s "https://hookbox.pages.dev/api/inboxes/$ID/requests" -H "Authorization: Bearer $TOKEN" | jq
```
