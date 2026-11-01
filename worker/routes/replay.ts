import type { Pair, ReplayResult } from '../../shared/types';
import { LIMITS } from '../env';
import type { Env } from '../env';
import { requireInbox } from '../lib/auth';
import { HttpError, jsonResponse, readJsonBody } from '../lib/http';
import { isSensitiveField } from '../lib/masking';
import { validateTarget } from '../lib/ssrf';
import { getRequestRow, hitRateLimit } from '../lib/store';

const DROPPED_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'expect',
  'accept-encoding',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'cf-connecting-ip',
  'cf-ray',
  'cf-ipcountry',
  'cf-visitor',
  'cf-worker',
  'x-hookbox-request-id',
]);

/** Headers that are only forwarded when the caller opts in explicitly. */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token',
  'x-stripe-signature',
  'stripe-signature',
  'x-hub-signature',
  'x-hub-signature-256',
  'x-slack-signature',
  'x-twilio-signature',
  'x-shopify-hmac-sha256',
  'x-telegram-bot-api-secret-token',
  'private-token',
]);

interface ReplayInput {
  targetUrl?: unknown;
  includeSensitiveHeaders?: unknown;
  method?: unknown;
  timeoutMs?: unknown;
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

/**
 * Replays a stored request against a *public* target chosen by the user.
 * Redirects are followed manually so each hop is re-validated (SSRF).
 */
export async function handleReplay(
  request: Request,
  env: Env,
  inboxId: string,
  requestId: string,
): Promise<Response> {
  await requireInbox(request, env, inboxId);
  const payload = await readJsonBody<ReplayInput>(request, 4096);

  const targetRaw = typeof payload.targetUrl === 'string' ? payload.targetUrl.trim() : '';
  if (targetRaw.length === 0) {
    throw new HttpError(400, 'missing_target', 'Provide targetUrl for the replay');
  }
  if (targetRaw.length > 2048) {
    throw new HttpError(400, 'invalid_target_url', 'Target URL is too long');
  }
  const includeSensitive = payload.includeSensitiveHeaders === true;

  const rate = await hitRateLimit(
    env.DB,
    `replay:${inboxId}`,
    60_000,
    LIMITS.replayPerInboxPerMinute,
  );
  if (!rate.allowed) {
    throw new HttpError(
      429,
      'rate_limited',
      `Replay is limited to ${LIMITS.replayPerInboxPerMinute}/minute`,
      {
        retryAfterMs: rate.retryAfterMs,
      },
    );
  }

  const stored = await getRequestRow(env.DB, inboxId, requestId);
  if (!stored) throw new HttpError(404, 'request_not_found', 'Request not found in this inbox');

  const methodInput = typeof payload.method === 'string' ? payload.method.trim().toUpperCase() : '';
  const method = (methodInput || stored.method).slice(0, 10);
  if (!/^[A-Z]{1,10}$/.test(method)) {
    throw new HttpError(400, 'invalid_method', 'method must be an HTTP method name');
  }

  const timeoutMs = Math.min(
    LIMITS.replayTimeoutMs,
    Math.max(
      1_000,
      Number.isFinite(Number(payload.timeoutMs))
        ? Number(payload.timeoutMs)
        : LIMITS.replayTimeoutMs,
    ),
  );

  const originalHeaders = JSON.parse(stored.headers) as Pair[];
  const sentHeaders: Pair[] = [];
  for (const [name, value] of originalHeaders) {
    const lower = name.toLowerCase();
    if (DROPPED_HEADERS.has(lower)) continue;
    if (!includeSensitive && (SENSITIVE_HEADERS.has(lower) || isSensitiveField(lower))) continue;
    sentHeaders.push([name, value]);
  }
  if (!sentHeaders.some(([name]) => name.toLowerCase() === 'accept')) {
    sentHeaders.push(['accept', '*/*']);
  }
  sentHeaders.push(['x-hookbox-replay', '1']);

  let bodyInit: BodyInit | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    if (stored.body_b64) {
      const binary = Uint8Array.from(atob(stored.body_b64), (char) => char.charCodeAt(0));
      if (binary.byteLength > LIMITS.replayMaxBodyBytes) {
        throw new HttpError(
          413,
          'payload_too_large',
          `Replay body exceeds ${LIMITS.replayMaxBodyBytes} bytes`,
        );
      }
      bodyInit = binary;
    } else if (stored.body_text) {
      if (stored.body_text.length > LIMITS.replayMaxBodyBytes) {
        throw new HttpError(
          413,
          'payload_too_large',
          `Replay body exceeds ${LIMITS.replayMaxBodyBytes} bytes`,
        );
      }
      bodyInit = stored.body_text;
    }
  }

  const started = Date.now();
  let currentUrl = targetRaw;
  let hops = 0;
  let response: Response | null = null;

  for (let hop = 0; hop <= LIMITS.replayMaxHops; hop += 1) {
    const target = await validateTarget(currentUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetch(target.url.toString(), {
        method,
        headers: new Headers(sentHeaders),
        body: bodyInit,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Replay request failed';
      throw new HttpError(502, 'replay_failed', `Target did not respond: ${message}`);
    } finally {
      clearTimeout(timer);
    }

    if (isRedirect(response.status)) {
      const location = response.headers.get('location');
      if (!location) break;
      if (hop === LIMITS.replayMaxHops) {
        throw new HttpError(
          502,
          'too_many_redirects',
          `Target redirected more than ${LIMITS.replayMaxHops} times`,
        );
      }
      currentUrl = new URL(location, target.url).toString();
      hops += 1;
      continue;
    }
    break;
  }

  if (!response) throw new HttpError(502, 'replay_failed', 'Replay produced no response');

  const raw = await response.arrayBuffer();
  const bytes = new Uint8Array(raw);
  const previewBytes = bytes.subarray(0, LIMITS.replayMaxResponsePreview);
  const previewText = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(
    previewBytes,
  );

  const result: ReplayResult = {
    status: response.status,
    statusText: response.statusText,
    durationMs: Date.now() - started,
    hops,
    finalUrl: response.url || currentUrl,
    requestHeaders: sentHeaders.map(([name, value]) => [
      name,
      SENSITIVE_HEADERS.has(name.toLowerCase()) ? '••••••' : value,
    ]) as Pair[],
    responseHeaders: [...response.headers.entries()].map(([name, value]) => [
      name,
      SENSITIVE_HEADERS.has(name.toLowerCase()) ? '••••••' : value,
    ]) as Pair[],
    bodyPreview: previewText,
    bodyPreviewTruncated: bytes.byteLength > LIMITS.replayMaxResponsePreview,
    bodyBytes: bytes.byteLength,
  };

  return jsonResponse({ replay: result });
}
