import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  isSensitiveField,
  isSensitiveHeader,
  maskPairs,
  redactForm,
  redactJson,
  redactMultipart,
  redactQueryPairs,
} from '../../worker/lib/masking';

describe('isSensitiveHeader', () => {
  it('flags common credential headers', () => {
    for (const header of [
      'authorization',
      'Authorization',
      'cookie',
      'x-api-key',
      'x-hub-signature-256',
      'stripe-signature',
      'x-telegram-bot-api-secret-token',
    ]) {
      expect(isSensitiveHeader(header)).toBe(true);
    }
  });

  it('leaves ordinary headers alone', () => {
    for (const header of ['content-type', 'user-agent', 'x-custom-header', 'accept']) {
      expect(isSensitiveHeader(header)).toBe(false);
    }
  });
});

describe('isSensitiveField', () => {
  it('detects token-ish JSON keys', () => {
    for (const key of [
      'password',
      'api_key',
      'apiKey',
      'access_token',
      'client_secret',
      'card_number',
      'cvv',
      'otp',
      'x-auth',
    ]) {
      expect(isSensitiveField(key)).toBe(true);
    }
  });

  it('keeps harmless metadata visible', () => {
    for (const key of [
      'token_type',
      'authorized',
      'event',
      'amount',
      'currency',
      'path',
      'session_count',
    ]) {
      expect(isSensitiveField(key)).toBe(false);
    }
  });
});

describe('maskPairs', () => {
  const pairs: Array<[string, string]> = [
    ['authorization', 'Bearer abc123'],
    ['x-api-key', 'sk_live_123456'],
    ['content-type', 'application/json'],
    ['x-request-id', 'req_1'],
  ];

  it('masks credential headers by default', () => {
    const masked = maskPairs(pairs, false);
    expect(masked[0]![1]).toBe(REDACTED);
    expect(masked[1]![1]).toBe(REDACTED);
    expect(masked[2]![1]).toBe('application/json');
    expect(masked[3]![1]).toBe('req_1');
  });

  it('returns raw values when revealed', () => {
    expect(maskPairs(pairs, true)[0]![1]).toBe('Bearer abc123');
  });

  it('keeps short auth-like values such as mode flags', () => {
    const masked = maskPairs([['x-auth-mode', 'basic']], false);
    expect(masked[0]![1]).toBe('basic');
  });
});

describe('redactJson', () => {
  it('masks nested sensitive keys while preserving structure', () => {
    const payload = JSON.stringify({
      event: 'order.paid',
      amount: 4200,
      customer: { email: 'a@example.com', password: 'hunter2hunter2' },
      tokens: [{ access_token: 'abcdef123456' }, { ok: true }],
    });
    const result = redactJson(payload);
    expect(result.redacted).toBe(true);
    const parsed = JSON.parse(result.text);
    expect(parsed.event).toBe('order.paid');
    expect(parsed.amount).toBe(4200);
    expect(parsed.customer.password).toBe(REDACTED);
    expect(parsed.customer.email).toBe('a@example.com');
    expect(parsed.tokens[0].access_token).toBe(REDACTED);
    expect(parsed.tokens[1].ok).toBe(true);
  });

  it('leaves non-secret payloads byte-identical', () => {
    const payload = '{"event":"ping","nested":{"count":2}}';
    const result = redactJson(payload);
    expect(result.redacted).toBe(false);
    expect(result.text).toBe(payload);
  });

  it('returns malformed JSON untouched', () => {
    const result = redactJson('{not json');
    expect(result.redacted).toBe(false);
    expect(result.text).toBe('{not json');
  });

  it('ignores very short values that cannot be credentials', () => {
    const result = redactJson('{"pin":"12"}');
    expect(result.redacted).toBe(false);
  });
});

describe('redactForm', () => {
  it('masks password fields and keeps the rest', () => {
    const result = redactForm('event=signup&email=demo%40example.com&password=hunter2hunter2');
    expect(result.redacted).toBe(true);
    const params = new URLSearchParams(result.text);
    expect(params.get('event')).toBe('signup');
    expect(params.get('email')).toBe('demo@example.com');
    expect(params.get('password')).toBe(REDACTED);
  });

  it('does not touch forms without sensitive fields', () => {
    const result = redactForm('event=ping&count=2');
    expect(result.redacted).toBe(false);
    expect(result.text).toBe('event=ping&count=2');
  });
});

describe('redactMultipart', () => {
  const boundary = 'b0undary';
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="note"',
    '',
    'hello world',
    `--${boundary}`,
    'Content-Disposition: form-data; name="password"',
    '',
    'hunter2hunter2',
    `--${boundary}--`,
    '',
  ].join('\r\n');

  it('masks sensitive text parts only', () => {
    const result = redactMultipart(body);
    expect(result.redacted).toBe(true);
    expect(result.text).toContain('hello world');
    expect(result.text).not.toContain('hunter2hunter2');
  });

  it('keeps file parts untouched', () => {
    const withFile = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="token"; filename="secret.txt"',
      'Content-Type: text/plain',
      '',
      'abcdef123456',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const result = redactMultipart(withFile);
    expect(result.redacted).toBe(false);
    expect(result.text).toContain('abcdef123456');
  });
});

describe('redactQueryPairs', () => {
  it('masks sensitive query values by default', () => {
    const pairs: Array<[string, string]> = [
      ['token', 'abcdef123456'],
      ['page', '2'],
    ];
    expect(redactQueryPairs(pairs, false)).toEqual([
      ['token', REDACTED],
      ['page', '2'],
    ]);
    expect(redactQueryPairs(pairs, true)).toEqual(pairs);
  });
});
