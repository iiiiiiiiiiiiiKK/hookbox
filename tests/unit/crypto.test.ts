import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  base64UrlDecode,
  base64UrlEncode,
  constantTimeEqual,
  hmacSha256Hex,
  isBase64Url,
  randomId,
  sha256Hex,
} from '../../worker/lib/crypto';

describe('randomId', () => {
  it('produces url-safe ids of the requested entropy', () => {
    const id = randomId(12);
    expect(id).toHaveLength(16);
    expect(isBase64Url(id)).toBe(true);
  });

  it('never repeats across a large sample', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => randomId(12)));
    expect(ids.size).toBe(2000);
  });

  it('supports 32-byte secrets', () => {
    const token = randomId(32);
    expect(token).toHaveLength(43);
    expect(isBase64Url(token)).toBe(true);
  });
});

describe('isBase64Url', () => {
  it('rejects non url-safe characters', () => {
    expect(isBase64Url('abc+def')).toBe(false);
    expect(isBase64Url('abc/def')).toBe(false);
    expect(isBase64Url('')).toBe(false);
    expect(isBase64Url('a-b_c9')).toBe(true);
  });
});

describe('hmacSha256Hex', () => {
  it('is deterministic for the same pepper and message', async () => {
    const first = await hmacSha256Hex('pepper', 'inbox:token');
    const second = await hmacSha256Hex('pepper', 'inbox:token');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the pepper or message changes', async () => {
    const base = await hmacSha256Hex('pepper', 'a');
    expect(await hmacSha256Hex('pepper2', 'a')).not.toBe(base);
    expect(await hmacSha256Hex('pepper', 'b')).not.toBe(base);
  });

  it('matches a known HMAC-SHA256 vector', async () => {
    // RFC 4231 test case 2.
    const digest = await hmacSha256Hex('Jefe', 'what do ya want for nothing?');
    expect(digest).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });
});

describe('sha256Hex', () => {
  it('matches the known digest for "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('constantTimeEqual', () => {
  it('compares equal and unequal strings', () => {
    expect(constantTimeEqual('abc123', 'abc123')).toBe(true);
    expect(constantTimeEqual('abc123', 'abc124')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});

describe('base64url helpers', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = base64UrlEncode(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect([...base64UrlDecode(encoded)]).toEqual([...bytes]);
  });

  it('formats hex with zero padding', () => {
    expect(bytesToHex(new Uint8Array([0, 15, 16, 255]))).toBe('000f10ff');
  });
});
