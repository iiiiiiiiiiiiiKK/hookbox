# Security model

HookBox is a public service that stores whatever third parties send to a public URL. This document
describes what is protected, how, and what is _not_ protected.

## Assets

| Asset                | Sensitivity                                | Where it lives                                 |
| -------------------- | ------------------------------------------ | ---------------------------------------------- |
| Inbox access token   | high — full read/delete of an inbox        | browser `localStorage`, sent as a bearer token |
| Request payloads     | high — often contain API keys, tokens, PII | D1 (`requests`), redacted on egress            |
| `AUTH_PEPPER`        | critical — derives token hashes            | Cloudflare secret only                         |
| Cloudflare API token | critical                                   | operator machine / CI secret                   |

## Controls

### Access control

- **Inbox id**: 12 random bytes (96 bits), base64url — not enumerable. Unknown ids return `404` before
  any token work.
- **Token**: 32 random bytes (256 bits) issued once at creation. Stored as
  `HMAC-SHA256(AUTH_PEPPER, inboxId + ":" + token)`; verification uses a constant-time comparison.
  Without the pepper, a database dump cannot verify guessed tokens.
- **Scope**: every SQL statement that touches requests is filtered by `inbox_id`, so a valid token for
  inbox A can never read inbox B. Verified by an integration test (`crossed` case).
- **State**: expired and deleted inboxes answer `410` before any data access; the UI drops the token
  from `localStorage` when it sees `410`.

### Input handling

- JSON bodies for control endpoints are capped at 16 KiB (4 KiB for create/extend) and parsed with a
  try/catch that returns `400 invalid_json`.
- Webhook bodies are capped at 256 KiB **while streaming**; a declared `content-length` above the cap is
  rejected before reading anything.
- Paths, methods and filters are validated against whitelists; `LIKE` patterns are escaped.
- SQL is always parameterised. No string interpolation of user input reaches SQLite.

### Output handling

- The API only ever returns JSON; stored payloads are never rendered as HTML. A CSP
  (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`), `nosniff` and
  `X-Frame-Options: DENY` protect the HTML shell.
- Redaction happens server-side, before serialisation:
  - headers: `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`,
    `*signature*`, `x-telegram-bot-api-secret-token`, `cf-access-jwt-assertion`, raw client IP headers
    (`cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`, …);
  - JSON/form/multipart fields whose key matches `pass|secret|token|api_key|authorization|cookie|
session|signature|card|cvv|ssn|otp|pin|credential|client_secret|refresh_token|id_token`, with an
    allowlist for harmless metadata (`token_type`, `authorized`, …).
- `?reveal=1` returns the raw payload and is an explicit, per-view action in the UI.
- Request bodies are never written to logs. Error logs contain only the error message.

### Replay / SSRF

The replay feature is the most dangerous surface, so it is deliberately narrow:

1. Scheme allowlist (`http`, `https`); URLs with embedded credentials are rejected.
2. Hostname blocklist (`localhost`, `*.localhost`, `*.local`, `*.internal`, `*.home.arpa`,
   `metadata.google.internal`, `kubernetes.default`, …).
3. Port allowlist: 80 and 443 only.
4. DNS resolution through DoH (Cloudflare, Google); **every** A/AAAA answer must be public.
   Blocked ranges: `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`,
   `192.0.0/24`, `192.0.2/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`,
   `224/4`, `240/4`, plus IPv6 loopback/unspecified, `fc00::/7`, `fe80::/10`, multicast,
   `2001:db8::/32` and IPv4-mapped / NAT64 forms of all of the above.
5. Redirects are followed manually (max 3) and each hop is re-validated from scratch.
6. 10 s timeout, 64 KiB request body, 4 KiB response preview, 10 replays/minute per inbox.
7. Credential headers are dropped unless the caller opts in; hop-by-hop and Cloudflare headers are
   always dropped.

### Abuse and cost control

| Vector             | Mitigation                                                                         |
| ------------------ | ---------------------------------------------------------------------------------- |
| Request flooding   | 120/min per inbox+IP and 120/min per IP, both D1-backed and shared across isolates |
| Inbox spam         | 30/hour and 60/day per IP, tracked by hashed creator IP                            |
| Storage exhaustion | 500 requests and 20 MB per inbox; oversized bodies rejected mid-stream             |
| Replay abuse       | 10/min per inbox, strict target validation                                         |
| Enumeration        | 96-bit ids, uniform `404` for unknown ids, uniform `401` for bad tokens            |
| Database growth    | TTL + sweep deletes requests and inboxes; rate-limit windows pruned after 3 h      |

### Transport

Everything runs on Cloudflare's edge over TLS 1.2+. The worker never makes plaintext outbound
connections (`http://` replay targets are allowed by the product, but they are the user's explicit
choice and only reach public hosts).

## Residual risks (accepted trade-offs)

1. **Token in `localStorage`.** XSS on the origin would leak the token. Mitigations: strict CSP, no
   third-party scripts, no `dangerouslySetInnerHTML`, JSON-only API. There are no accounts to steal.
2. **DNS rebinding during replay.** The Worker validates the resolved addresses but cannot pin the IP
   that `fetch` will use. Port restrictions (80/443) and metadata-address blocking remove the classic
   exploitation targets; an internal-network pivot via a rebinding domain remains theoretically
   possible.
3. **Anything the sender sends is stored.** HookBox is a debugging tool: if you point a production
   webhook at it, real secrets can arrive. Data is capped, TTL-bounded and masked in the UI, but you
   should still use test-mode credentials.
4. **Shared inference from error codes.** `404` vs `410` reveals whether an id once existed. Inbox ids
   are random, so this is not enumerable in practice.
5. **No per-tenant isolation at the database level.** All inboxes share one D1 database; isolation is
   enforced by the application layer (`inbox_id` filters), not by separate databases.
6. **IP hashes are HMACs, not anonymisation.** With the pepper, an operator can confirm a guessed IP.

## Operator checklist

- Never commit `.dev.vars`, `.env`, or `AUTH_PEPPER`.
- Rotate `AUTH_PEPPER` if it leaks — this invalidates every existing inbox token (documented
  behaviour, not a bug).
- Keep `EXTRA_CORS_ORIGINS` empty unless you really serve the API cross-origin.
- Watch the Cloudflare dashboard for request/CPU anomalies; the free plan caps damage but not abuse.
- If you enable the cron trigger, keep the request-path sweep too (they are complementary).

## Reporting a vulnerability

Please open a private security advisory on GitHub, or contact the maintainer at
<https://x.com/0xkillcoin>. Do not open a public issue with a working exploit.
