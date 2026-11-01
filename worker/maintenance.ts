import type { Env } from './env';
import { hitRateLimit, sweepExpired } from './lib/store';

/**
 * TTL enforcement.
 *
 * Cloudflare Cron Triggers are the canonical way to do this, but the free plan
 * allows only 5 cron triggers per account and this account already uses all of
 * them. HookBox therefore drains expired rows from inside the API request path:
 * every authenticated call schedules `maybeSweep`, which is throttled to one
 * real sweep per minute with a D1 rate-limit row.
 *
 * Consequences (documented in the README):
 *  - expired inboxes are already unreachable (HTTP 410) before their rows are
 *    deleted, so no stale data is ever served;
 *  - rows are physically removed within a minute of any API activity;
 *  - a completely idle deployment keeps the last rows until the next visit,
 *    bounded by the inbox TTL and the 500-row / 20 MB per-inbox caps.
 */
export async function runCleanup(
  env: Env,
): Promise<{ inboxes: number; requests: number; rateLimits: number }> {
  const result = await sweepExpired(env.DB);
  if (result.inboxes > 0) {
    console.log('hookbox:cleanup', JSON.stringify(result));
  }
  return result;
}

const SWEEP_WINDOW_MS = 60_000;

export async function maybeSweep(env: Env): Promise<void> {
  try {
    const gate = await hitRateLimit(env.DB, 'maintenance:sweep', SWEEP_WINDOW_MS, 1);
    if (!gate.allowed) return;
    await runCleanup(env);
  } catch (error) {
    // Cleanup must never break a user request.
    console.error('hookbox:sweep_failed', error instanceof Error ? error.message : String(error));
  }
}
