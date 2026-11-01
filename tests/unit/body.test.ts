import { describe, expect, it } from 'vitest';
import { parseBody, parseMultipartParts } from '../../worker/lib/body';

const encode = (value: string) => new TextEncoder().encode(value);

describe('parseBody', () => {
  it('detects empty bodies', () => {
    const parsed = parseBody(encode(''), 'application/json');
    expect(parsed.kind).toBe('empty');
    expect(parsed.size).toBe(0);
  });

  it('parses JSON payloads', () => {
    const parsed = parseBody(encode('{"event":"ping"}'), 'application/json; charset=utf-8');
    expect(parsed.kind).toBe('json');
    expect(parsed.text).toBe('{"event":"ping"}');
  });

  it('parses JSON suffixed content types', () => {
    expect(parseBody(encode('{"a":1}'), 'application/vnd.api+json').kind).toBe('json');
  });

  it('parses XML payloads by header and by sniffing', () => {
    expect(parseBody(encode('<a/>'), 'application/xml').kind).toBe('xml');
    expect(parseBody(encode('<a/>'), null).kind).toBe('xml');
  });

  it('parses url-encoded forms', () => {
    const parsed = parseBody(encode('a=1&b=2'), 'application/x-www-form-urlencoded');
    expect(parsed.kind).toBe('form');
  });

  it('sniffs form bodies without a content type', () => {
    expect(parseBody(encode('a=1&b=2'), null).kind).toBe('form');
  });

  it('treats text/* as text', () => {
    expect(parseBody(encode('hello'), 'text/plain').kind).toBe('text');
  });

  it('sniffs JSON without a content type', () => {
    expect(parseBody(encode('  {"a":1}'), null).kind).toBe('json');
  });

  it('falls back to text for unparsable sniffed JSON', () => {
    expect(parseBody(encode('{oops'), 'application/octet-stream').kind).toBe('text');
  });

  it('keeps binary payloads as base64 with a hex preview', () => {
    const bytes = new Uint8Array([0x00, 0xff, 0xfe, 0x80, 0x81]);
    const parsed = parseBody(bytes, 'application/octet-stream');
    expect(parsed.kind).toBe('binary');
    expect(parsed.base64).toBe(Buffer.from(bytes).toString('base64'));
    expect(parsed.hexPreview).toBe('00fffe8081');
    expect(parsed.text).toBeUndefined();
  });

  it('never decodes binary as UTF-8 even when the bytes look textual', () => {
    const parsed = parseBody(new Uint8Array([0xc3, 0x28]), 'image/png');
    expect(parsed.kind).toBe('binary');
  });

  it('parses multipart bodies into parts', () => {
    const boundary = 'xyz';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="name"',
      '',
      'HookBox',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="a.txt"',
      'Content-Type: text/plain',
      '',
      'file body',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const parsed = parseBody(encode(body), `multipart/form-data; boundary=${boundary}`);
    expect(parsed.kind).toBe('multipart');
    expect(parsed.parts).toHaveLength(2);
    expect(parsed.parts?.[0]).toMatchObject({ name: 'name', filename: null, preview: 'HookBox' });
    expect(parsed.parts?.[1]).toMatchObject({
      name: 'file',
      filename: 'a.txt',
      contentType: 'text/plain',
    });
  });

  it('returns an empty part list when the boundary is missing', () => {
    expect(parseMultipartParts('irrelevant', 'multipart/form-data')).toEqual([]);
  });
});
