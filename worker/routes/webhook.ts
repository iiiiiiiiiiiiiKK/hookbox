import type { Pair } from '../../shared/types';
import { LIMITS } from '../env';
import type { Env } from '../env';
import { hashSourceIp, loadLiveInbox, requirePepper } from '../lib/auth';
import { parseBody } from '../lib/body';
import { clientIp, HttpError, jsonResponse, readBodyLimited } from '../lib/http';
import { hitRateLimit, insertRequest } from '../lib/store';

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-max-age': '86400',
};

/**
 * Public webhook receiver: `/hook/:inboxId/<anything>`.
 * Every accepted request is persisted, then the inbox owner can read it back
 * through the authenticated API.
 */
export async function handleWebhook(
  request: Request,
  env: Env,
  url: URL,
  inboxId: string,
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const pepper = requirePepper(env);
  const now = Date.now();
  const inbox = await loadLiveInbox(env, inboxId, now);

  const ip = clientIp(request);
  const ipHash = await hashSourceIp(pepper, ip);

  const perInbox = await hitRateLimit(
    env.DB,
    `hook:${inbox.id}:${ipHash ?? 'unknown'}`,
    60_000,
    LIMITS.webhookPerInboxPerMinute,
    now,
  );
  if (!perInbox.allowed) {
    throw new HttpError(
      429,
      'rate_limited',
      `Too many requests for this inbox (limit ${LIMITS.webhookPerInboxPerMinute}/minute)`,
      { retryAfterMs: perInbox.retryAfterMs },
    );
  }
  const perIp = await hitRateLimit(
    env.DB,
    `iphook:${ipHash ?? 'unknown'}`,
    60_000,
    LIMITS.webhookPerIpPerMinute,
    now,
  );
  if (!perIp.allowed) {
    throw new HttpError(429, 'rate_limited', 'Too many requests from this IP address', {
      retryAfterMs: perIp.retryAfterMs,
    });
  }

  if (inbox.request_count >= LIMITS.maxRequestsPerInbox) {
    throw new HttpError(
      429,
      'inbox_full',
      `This inbox already holds ${LIMITS.maxRequestsPerInbox} requests. Clear it in HookBox to keep receiving.`,
      { details: { maxRequests: LIMITS.maxRequestsPerInbox } },
    );
  }

  const declaredSize = Number(request.headers.get('content-length') ?? '');
  if (
    Number.isFinite(declaredSize) &&
    inbox.storage_bytes + declaredSize > LIMITS.maxStoragePerInboxBytes
  ) {
    throw new HttpError(
      429,
      'inbox_storage_full',
      `This inbox is close to its ${Math.round(LIMITS.maxStoragePerInboxBytes / 1024 / 1024)} MB storage limit. Clear it in HookBox to keep receiving.`,
    );
  }

  const body = await readBodyLimited(request, LIMITS.maxBodyBytes);
  if (inbox.storage_bytes + body.bytes.byteLength > LIMITS.maxStoragePerInboxBytes) {
    throw new HttpError(
      429,
      'inbox_storage_full',
      `This inbox is close to its ${Math.round(LIMITS.maxStoragePerInboxBytes / 1024 / 1024)} MB storage limit. Clear it in HookBox to keep receiving.`,
    );
  }

  const contentType = request.headers.get('content-type');
  const parsed = parseBody(body.bytes, contentType);
  const query: Pair[] = [];
  for (const [key, value] of url.searchParams.entries()) query.push([key, value]);
  const headers: Pair[] = [];
  for (const [key, value] of request.headers.entries()) headers.push([key, value]);

  const receivedAt = Date.now();
  const requestId = await insertRequest(env.DB, {
    inboxId: inbox.id,
    method: request.method.toUpperCase(),
    path: url.pathname,
    query,
    headers,
    bodyText: parsed.text ?? null,
    bodyB64: parsed.base64 ?? null,
    bodyKind: parsed.kind,
    contentType,
    bodySize: parsed.size,
    sourceIpHash: ipHash,
    userAgent: request.headers.get('user-agent'),
    receivedAt,
  });

  return jsonResponse(
    {
      ok: true,
      id: requestId,
      inbox: inbox.id,
      method: request.method.toUpperCase(),
      path: url.pathname,
      bodyKind: parsed.kind,
      bodyBytes: parsed.size,
      receivedAt,
      note: 'Stored. Inspect it in your HookBox inbox.',
    },
    { status: 200, headers: { ...CORS_HEADERS, 'x-hookbox-request-id': requestId } },
  );
}
