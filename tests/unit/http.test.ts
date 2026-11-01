import { describe, expect, it } from 'vitest';
import {
  HttpError,
  clampInt,
  errorResponse,
  jsonResponse,
  readBodyLimited,
  readJsonBody,
} from '../../worker/lib/http';

describe('clampInt', () => {
  it('clamps within bounds and falls back for garbage', () => {
    expect(clampInt('5', 1, 10, 3)).toBe(5);
    expect(clampInt('0', 1, 10, 3)).toBe(1);
    expect(clampInt('99', 1, 10, 3)).toBe(10);
    expect(clampInt(null, 1, 10, 3)).toBe(3);
    expect(clampInt('abc', 1, 10, 3)).toBe(3);
  });
});

describe('jsonResponse', () => {
  it('sets json + hardening headers', async () => {
    const response = jsonResponse({ ok: true }, { status: 201 });
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe('errorResponse', () => {
  it('serializes HttpError with a retry-after header', async () => {
    const response = errorResponse(
      new HttpError(429, 'rate_limited', 'slow down', { retryAfterMs: 2500 }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('3');
    const body = (await response.json()) as { error: Record<string, unknown> };
    expect(body.error).toMatchObject({
      code: 'rate_limited',
      message: 'slow down',
      retryAfterMs: 2500,
    });
  });

  it('hides internal error details', async () => {
    const response = errorResponse(new Error('database exploded'));
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('internal_error');
    expect(JSON.stringify(body)).not.toContain('database exploded');
  });
});

describe('readBodyLimited', () => {
  it('reads a small body', async () => {
    const request = new Request('http://local/hook', { method: 'POST', body: 'hello' });
    const body = await readBodyLimited(request, 1024);
    expect(new TextDecoder().decode(body.bytes)).toBe('hello');
  });

  it('rejects bodies larger than the limit', async () => {
    const request = new Request('http://local/hook', { method: 'POST', body: 'x'.repeat(5000) });
    await expect(readBodyLimited(request, 1024)).rejects.toMatchObject({
      status: 413,
      code: 'payload_too_large',
    });
  });

  it('rejects early when content-length is already too large', async () => {
    const request = new Request('http://local/hook', {
      method: 'POST',
      headers: { 'content-length': '999999' },
      body: 'tiny',
    });
    await expect(readBodyLimited(request, 1024)).rejects.toMatchObject({ status: 413 });
  });

  it('handles requests without a body', async () => {
    const request = new Request('http://local/hook', { method: 'POST' });
    const body = await readBodyLimited(request, 1024);
    expect(body.bytes.byteLength).toBe(0);
  });
});

describe('readJsonBody', () => {
  it('parses JSON and defaults to an empty object', async () => {
    const withBody = new Request('http://local/', { method: 'POST', body: '{"a":1}' });
    expect(await readJsonBody(withBody)).toEqual({ a: 1 });
    const empty = new Request('http://local/', { method: 'POST' });
    expect(await readJsonBody(empty)).toEqual({});
  });

  it('rejects malformed JSON with 400', async () => {
    const request = new Request('http://local/', { method: 'POST', body: '{oops' });
    await expect(readJsonBody(request)).rejects.toMatchObject({
      status: 400,
      code: 'invalid_json',
    });
  });
});
