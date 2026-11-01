import type { MetaResponse } from '../shared/types';
import { APP_NAME, APP_VERSION, LIMITS } from './env';
import type { Env } from './env';
import { maybeSweep, runCleanup } from './maintenance';
import { HttpError, errorResponse, jsonResponse } from './lib/http';
import { handleEventStream } from './routes/events';
import {
  handleCreateInbox,
  handleDeleteInbox,
  handleExtendInbox,
  handleGetInbox,
} from './routes/inboxes';
import {
  handleClearRequests,
  handleDeleteRequest,
  handleExport,
  handleGetRequest,
  handleListRequests,
} from './routes/requests';
import { handleReplay } from './routes/replay';
import { handleWebhook } from './routes/webhook';

const INBOX_ID = '([A-Za-z0-9_-]{8,32})';
const REQUEST_ID = '([A-Za-z0-9_-]{4,32})';

const ROUTES: Array<{
  pattern: RegExp;
  methods: string[];
  handler: (request: Request, env: Env, url: URL, params: string[]) => Promise<Response>;
}> = [
  {
    pattern: new RegExp(`^/api/inboxes/${INBOX_ID}$`),
    methods: ['GET'],
    handler: (request, env, url, [id]) => handleGetInbox(request, env, url, id!),
  },
  {
    pattern: new RegExp(`^/api/inboxes/${INBOX_ID}$`),
    methods: ['DELETE'],
    handler: (request, env, _url, [id]) => handleDeleteInbox(request, env, id!),
  },
  {
    pattern: new RegExp(`^/api/inboxes/${INBOX_ID}/extend$`),
    methods: ['POST'],
    handler: (request, env, url, [id]) => handleExtendInbox(request, env, url, id!),
  },
  {
    pattern: new RegExp(`^/api/inboxes/${INBOX_ID}/requests$`),
    methods: ['GET'],
    handler: (request, env, url, [id]) => handleListRequests(request, env, url, id!),
  },
  {
    pattern: new RegExp(`^/api/inboxes/${INBOX_ID}/requests$`),
    methods: ['DELETE'],
    handler: (request, env, _url, [id]) => handleClearRequests(request, env, id!),
  },
  {
    pattern: new RegExp(`^/api/inboxes/${INBOX_ID}/requests/${REQUEST_ID}$`),
    methods: ['GET'],
    handler: (request, env, url, [id, requestId]) =>
      handleGetRequest(request, env, url, id!, requestId!),
  },
  {
    pattern: new RegExp(`^/api/inboxes/${INBOX_ID}/requests/${REQUEST_ID}$`),
    methods: ['DELETE'],
    handler: (request, env, _url, [id, requestId]) =>
      handleDeleteRequest(request, env, id!, requestId!),
  },
  {
    pattern: new RegExp(`^/api/inboxes/${INBOX_ID}/requests/${REQUEST_ID}/replay$`),
    methods: ['POST'],
    handler: (request, env, _url, [id, requestId]) => handleReplay(request, env, id!, requestId!),
  },
  {
    pattern: new RegExp(`^/api/inboxes/${INBOX_ID}/export$`),
    methods: ['GET'],
    handler: (request, env, url, [id]) => handleExport(request, env, url, id!),
  },
  {
    pattern: new RegExp(`^/api/inboxes/${INBOX_ID}/stream$`),
    methods: ['GET'],
    handler: (request, env, url, [id]) => handleEventStream(request, env, url, id!),
  },
];

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
};

const HTML_CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  const allowed = new Set(
    (env.EXTRA_CORS_ORIGINS ?? '')
      .split(',')
      .map((entry) => entry.trim().replace(/\/+$/, ''))
      .filter((entry) => entry.length > 0),
  );
  const requestOrigin = new URL(request.url).origin;
  if (origin === requestOrigin || allowed.has(origin)) {
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization, content-type, x-inbox-token',
      'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
      vary: 'origin',
    };
  }
  return {};
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const cors = corsHeaders(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...cors, ...SECURITY_HEADERS } });
  }

  if (url.pathname === '/api/health') {
    return jsonResponse(
      { ok: true, name: APP_NAME, version: APP_VERSION, serverTime: Date.now() },
      { headers: cors },
    );
  }

  if (url.pathname === '/api/meta') {
    const meta: MetaResponse = {
      name: APP_NAME,
      version: APP_VERSION,
      serverTime: Date.now(),
      limits: {
        maxBodyBytes: LIMITS.maxBodyBytes,
        maxRequestsPerInbox: LIMITS.maxRequestsPerInbox,
        maxStoragePerInboxBytes: LIMITS.maxStoragePerInboxBytes,
        allowedTtlHours: LIMITS.allowedTtlHours,
        maxTtlHours: LIMITS.maxTtlHours,
        webhookPerInboxPerMinute: LIMITS.webhookPerInboxPerMinute,
        webhookPerIpPerMinute: LIMITS.webhookPerIpPerMinute,
        inboxCreatePerIpPerHour: LIMITS.inboxCreatePerIpPerHour,
        inboxCreatePerIpPerDay: LIMITS.inboxCreatePerIpPerDay,
        replayPerInboxPerMinute: LIMITS.replayPerInboxPerMinute,
        replayTimeoutMs: LIMITS.replayTimeoutMs,
        listPageSizeMax: LIMITS.listPageSizeMax,
        sseMaxDurationMs: LIMITS.sseMaxDurationMs,
      },
      features: { realtime: 'sse', replay: true, redaction: true, exports: true },
    };
    return jsonResponse(meta, { headers: cors });
  }

  if (url.pathname === '/api/inboxes') {
    if (request.method !== 'POST') {
      throw new HttpError(405, 'method_not_allowed', 'Use POST to create an inbox');
    }
    const response = await handleCreateInbox(request, env, url);
    return withHeaders(response, cors);
  }

  let pathMatched = false;
  for (const route of ROUTES) {
    const match = route.pattern.exec(url.pathname);
    if (!match) continue;
    pathMatched = true;
    if (!route.methods.includes(request.method)) continue;
    const response = await route.handler(request, env, url, match.slice(1));
    return withHeaders(response, cors);
  }

  if (pathMatched) {
    throw new HttpError(
      405,
      'method_not_allowed',
      `${request.method} is not allowed on this endpoint`,
    );
  }

  throw new HttpError(404, 'not_found', 'Unknown API endpoint');
}

function withHeaders(response: Response, headers: Record<string, string>): Response {
  if (Object.keys(headers).length === 0) return response;
  const merged = new Headers(response.headers);
  for (const [name, value] of Object.entries(headers)) merged.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}

async function handleAssetRequest(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
    headers.set('content-security-policy', HTML_CSP);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  return response;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) {
        const response = await handleApi(request, env, url);
        // Expired rows are drained off the hot path, at most once a minute.
        ctx.waitUntil(maybeSweep(env));
        return response;
      }
      if (url.pathname.startsWith('/hook/')) {
        // `/hook/:inboxId[/any/sub/path]`
        const inboxId = url.pathname.split('/')[2] ?? '';
        return await handleWebhook(request, env, url, inboxId);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        throw new HttpError(405, 'method_not_allowed', 'Only GET and HEAD are supported here');
      }
      return await handleAssetRequest(request, env);
    } catch (error) {
      const response = errorResponse(error);
      if (url.pathname.startsWith('/hook/')) {
        const headers = new Headers(response.headers);
        headers.set('access-control-allow-origin', '*');
        return new Response(response.body, { status: response.status, headers });
      }
      return response;
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCleanup(env));
  },
};
