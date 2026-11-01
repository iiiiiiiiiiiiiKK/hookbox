# Deployment

HookBox runs on Cloudflare **Pages** (recommended) or **Workers**. Both serve the same bundle; pick one
per environment — do not point two deployments at different peppers and expect tokens to be
interchangeable.

## Prerequisites

- A Cloudflare account (free plan is enough).
- A D1 database.
- An API token with **Pages:Edit**, **D1:Edit** (and **Workers Scripts:Edit** if you also deploy the
  Worker) — or run `wrangler login` interactively.

## Environment variables and secrets

| Name                    | Kind         | Required    | Purpose                                                                                                                              |
| ----------------------- | ------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `AUTH_PEPPER`           | secret       | yes         | Derives inbox token hashes and IP hashes. ≥ 16 chars, 32 random bytes recommended. Rotating it invalidates every existing token.     |
| `PUBLIC_ORIGIN`         | plain var    | no          | Overrides the origin used to build webhook URLs (useful behind a custom domain or when the request origin is not the public origin). |
| `EXTRA_CORS_ORIGINS`    | plain var    | no          | Comma-separated extra browser origins allowed to call the API. Leave empty in normal use.                                            |
| `CLOUDFLARE_API_TOKEN`  | operator env | deploy only | Used by `scripts/deploy-pages.mjs` and wrangler. Never commit it.                                                                    |
| `CLOUDFLARE_ACCOUNT_ID` | operator env | deploy only | Account id.                                                                                                                          |

Generate a pepper:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 1. Create and migrate the database

```bash
npx wrangler d1 create hookbox-db
```

Copy the returned `database_id` into `wrangler.jsonc`, then:

```bash
npx wrangler d1 migrations apply hookbox-db --remote
```

Locally: `npm run db:init` (applies to `.wrangler/state`).

## 2. Option A — Cloudflare Pages (recommended)

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
export AUTH_PEPPER=...        # required on the first deploy, omit afterwards
node scripts/deploy-pages.mjs
```

What the script does:

1. `vite build` → `dist/` (SPA assets).
2. `esbuild worker/index.ts` → `dist/_worker.js` (advanced-mode Pages function).
3. Creates the Pages project (`hookbox`) if it does not exist.
4. Patches the production deployment config: D1 binding `DB` → your database, `AUTH_PEPPER` secret
   (only when `AUTH_PEPPER` is passed, so later deploys keep existing tokens valid).
5. Uploads `dist/` and prints the URL, `https://<project>.pages.dev`.

Advanced mode means every request goes through `_worker.js`, which still has the `ASSETS` binding, so
`worker/index.ts` runs unchanged.

## 3. Option B — Cloudflare Workers

```bash
npm run build
npx wrangler d1 migrations apply hookbox-db --remote
npx wrangler secret put AUTH_PEPPER      # paste the pepper when prompted
npm run deploy
```

`wrangler.jsonc` already enables `workers_dev`, so the Worker is reachable at
`https://<worker>.<subdomain>.workers.dev`.

### Cron triggers

The config ships with the trigger commented out because free accounts are limited to **5 cron triggers
per account**. If you have a free slot:

```jsonc
"triggers": { "crons": ["*/5 * * * *"] }
```

Even without cron, expired rows are removed by the request-path sweep (once a minute, triggered by API
traffic). Expired inboxes answer `410` immediately in both cases.

## 4. Custom domain

1. Add the domain to Cloudflare (the zone must be active).
2. Pages: **Custom domains → Set up a custom domain** (or `wrangler pages domain`), Workers: add a route
   in the dashboard or `routes` in `wrangler.jsonc`.
3. Optionally set `PUBLIC_ORIGIN` to the new origin so generated webhook URLs use it.

A custom domain is strongly recommended: `*.workers.dev` is unreachable on some networks (including
many mainland-China ISPs), while `*.pages.dev` is more widely reachable but still not guaranteed.

## 5. Verify

```bash
node scripts/verify-live.mjs https://your-deployment.example
```

This drives 22 real HTTP checks: static shell + headers, meta/health, inbox creation, real webhook
delivery for five methods and four body kinds, masking + reveal, filters, SSE streaming, SSRF blocks,
a real replay to a public endpoint, export, TTL extension, `413`, `404`, request deletion, inbox
deletion.

## 6. CI/CD

`.github/workflows/ci.yml` runs typecheck, unit tests, build, integration tests and Playwright on every
push. `.github/workflows/deploy-pages.yml` deploys on a tag or manual dispatch.

To enable the deploy workflow, add repository secrets:

| Secret                  | Value                                 |
| ----------------------- | ------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | token with Pages:Edit + D1:Edit       |
| `CLOUDFLARE_ACCOUNT_ID` | your account id                       |
| `AUTH_PEPPER`           | only needed for the very first deploy |

## Troubleshooting

| Symptom                                                              | Cause / fix                                                                                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `System limit reached: databases per account (10)`                   | Free accounts allow 10 D1 databases. Drop an unused one or reuse an existing database (tables are namespaced and additive). |
| `This account has reached the Workers Free limit of 5 cron triggers` | Remove the cron block from `wrangler.jsonc`; the request-path sweep still cleans up.                                        |
| `There was an access violation in the runtime` from `wrangler dev`   | `workerd` cannot start on that Windows image. Run the integration suite instead (`npm run test:integration`), or use WSL.   |
| Webhooks answer `410` immediately after creation                     | The deployment's `AUTH_PEPPER` changed after the inbox was created (redeploy with a new pepper). Create a new inbox.        |
| `401 invalid_token` for an inbox that worked before                  | Token rotated or inbox deleted; or you are calling a different deployment that shares the database but not the pepper.      |
| `403` from the Cloudflare API during deploy                          | The API token is missing Pages:Edit / D1:Edit.                                                                              |
| UI shows `Polling · 4s` instead of `Live · SSE`                      | A proxy is buffering `text/event-stream`; the app falls back automatically and states it in the status bar.                 |
| `429 inbox_full`                                                     | An inbox reached 500 requests; clear it in the UI or create a new one.                                                      |
