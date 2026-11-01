# Limits and cost

HookBox enforces its own limits so that a free deployment cannot be turned into someone else's data
sink. The numbers live in `worker/env.ts` (`LIMITS`) and are published at `GET /api/meta`, which is
what the UI displays.

## Product limits

| Limit                     | Value                       | Enforced by                    | Response                                        |
| ------------------------- | --------------------------- | ------------------------------ | ----------------------------------------------- |
| Request body              | 256 KiB                     | `readBodyLimited` (streaming)  | `413 payload_too_large`                         |
| Requests per inbox        | 500                         | counter check before insert    | `429 inbox_full`                                |
| Storage per inbox         | 20 MB                       | counter check + body size      | `429 inbox_storage_full`                        |
| Inbox TTL                 | 1 h / 6 h / 24 h            | create validation              | `400 invalid_ttl`                               |
| TTL extension             | up to 24 h from creation    | extend endpoint                | `409 ttl_capped`                                |
| Webhook rate per inbox+IP | 120 / minute                | D1 fixed window                | `429 rate_limited`                              |
| Webhook rate per IP       | 120 / minute                | D1 fixed window                | `429 rate_limited`                              |
| Inbox creation per IP     | 30 / hour, 60 / day         | D1 fixed window + count        | `429 rate_limited` / `429 inbox_quota_exceeded` |
| Replay per inbox          | 10 / minute                 | D1 fixed window                | `429 rate_limited`                              |
| Replay timeout / body     | 10 s / 64 KiB               | `AbortController` / size check | `502` / `413`                                   |
| Replay redirects          | 3 hops                      | manual loop                    | `502 too_many_redirects`                        |
| List page size            | 50 default, 100 max         | query clamp                    | —                                               |
| SSE connection            | 25 s, reconnect with cursor | stream loop                    | —                                               |

Replays are additionally restricted to public HTTP(S) on ports 80/443 — see [SECURITY.md](SECURITY.md).

## Platform quotas (free plan)

Verified against Cloudflare's documentation in October 2026. Check the current plan pages before
relying on them for capacity planning.

| Service               | Free allowance       | Notes                                                     |
| --------------------- | -------------------- | --------------------------------------------------------- |
| Workers requests      | 100,000 / day        | every `/api/*` and `/hook/*` call counts                  |
| Workers CPU           | 10 ms per invocation | webhook path typically < 2 ms                             |
| Workers cron triggers | 5 per account        | this account already uses all 5 → request-path sweep      |
| D1 storage            | 5 GB total           | rows are deleted on TTL                                   |
| D1 rows read          | 5,000,000 / day      | ~1 read per webhook, ~2 per list page                     |
| D1 rows written       | 100,000 / day        | ~3 writes per webhook                                     |
| Pages static requests | unlimited            | assets are served by the edge                             |
| Pages Functions       | 100,000 / day        | same limit as Workers                                     |
| Pages builds          | 500 / month          | deployments via `wrangler pages deploy` are not CI builds |

### What one webhook actually costs

```
read inbox            1 row read
rate limit (inbox)    1 write + 1 read (upsert + select, one batch)
rate limit (IP)       1 write + 1 read
insert request        1 write
update counters       1 write   (same transaction)
```

≈ **3 writes, 3 reads, one invocation**. With the free D1 write budget (100k/day) the practical ceiling
is ~33k webhooks/day; the Workers request budget (100k/day) is not the bottleneck. A browser viewer adds
one request per 25 s SSE cycle plus a D1 read every 1.2 s inside the Worker.

### What the caps mean for users

- 500 requests × 256 KiB = at most 128 MB uncompressed per inbox, but the 20 MB storage cap hits first
  (an inbox of 256 KiB bodies holds ~80 requests).
- TTL cleanup bounds database growth: the sweep removes at most 50 inboxes per minute, which is far
  above the creation limit of 30/hour per IP.

## Tuning

All limits are constants in `worker/env.ts`. If you self-host with a paid plan:

- Raise `maxBodyBytes` if you need larger payloads (a paid Worker gets 30 s wall clock and more memory,
  but keep the streaming approach).
- Raise `maxRequestsPerInbox` together with `maxStoragePerInboxBytes`, not instead of it.
- Raise `webhookPerInboxPerMinute` for noisy providers (GitHub initially bursts several events).
- Keep `replayPerInboxPerMinute` small — replay is the only feature that makes outbound requests.
- If you enable cron, you can lower the request-path sweep frequency (the throttle is in
  `worker/maintenance.ts`).

## Cost safety checklist

- Never enable a paid plan to "remove limits" — the abuse protections are the point.
- Do not add client-configurable limits (they become an amplification vector).
- Keep D1 `PRAGMA` optimisations out of the migration; D1 manages its own storage.
- Watch for `429` spikes: they are normal under demos, alarming under organic traffic.
