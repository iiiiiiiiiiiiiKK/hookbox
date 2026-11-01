import type { ApiErrorBody } from '../../shared/types';

export class HttpError extends Error {
  status: number;
  code: string;
  retryAfterMs?: number;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { retryAfterMs?: number; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.retryAfterMs = options.retryAfterMs;
    this.details = options.details;
  }
}

const BASE_HEADERS: Record<string, string> = {
  'cache-control': 'no-store, max-age=0',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...BASE_HEADERS,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    const body: ApiErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {}),
        ...(error.details ? { details: error.details } : {}),
      },
    };
    const headers: Record<string, string> = {};
    if (error.retryAfterMs) headers['retry-after'] = String(Math.ceil(error.retryAfterMs / 1000));
    return jsonResponse(body, { status: error.status, headers });
  }

  const message = error instanceof Error ? error.message : 'Unexpected server error';
  console.error('hookbox:unhandled_error', message);
  const body: ApiErrorBody = {
    error: { code: 'internal_error', message: 'Internal server error' },
  };
  return jsonResponse(body, { status: 500 });
}

export async function readJsonBody<T = Record<string, unknown>>(
  request: Request,
  maxBytes = 16 * 1024,
): Promise<T> {
  const raw = await readBodyLimited(request, maxBytes);
  if (raw.bytes.byteLength === 0) return {} as T;
  const text = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(raw.bytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be valid JSON');
  }
}

export interface LimitedBody {
  bytes: Uint8Array;
  truncated: boolean;
  /** Size as reported by the client, if it was declared. */
  declaredSize: number | null;
}

/**
 * Streams a request body while enforcing a hard byte ceiling.
 * Oversized bodies are rejected before being buffered into memory.
 */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<LimitedBody> {
  const declared = request.headers.get('content-length');
  const declaredSize = declared && /^\d+$/.test(declared) ? Number(declared) : null;
  if (declaredSize !== null && declaredSize > maxBytes) {
    throw new HttpError(413, 'payload_too_large', `Body exceeds the ${maxBytes} byte limit`, {
      details: { maxBytes, declaredSize },
    });
  }
  if (!request.body) return { bytes: new Uint8Array(0), truncated: false, declaredSize };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new HttpError(413, 'payload_too_large', `Body exceeds the ${maxBytes} byte limit`, {
          details: { maxBytes },
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated: false, declaredSize };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clientIp(request: Request): string | null {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return null;
}

export function clampInt(value: string | null, min: number, max: number, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function timingSafeTimeString(value: number): string {
  return new Date(value).toISOString();
}
