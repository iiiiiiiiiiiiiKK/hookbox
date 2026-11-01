import type { BodyKind, MultipartPart } from '../../shared/types';
import { LIMITS } from '../env';
import { bytesToBase64, bytesToHex } from './crypto';

export interface ParsedBody {
  kind: BodyKind;
  /** UTF-8 decoded payload for text-ish bodies. Never redacted at rest. */
  text?: string;
  /** Base64 payload for binary bodies. */
  base64?: string;
  hexPreview?: string;
  parts?: MultipartPart[];
  size: number;
  truncated: boolean;
}

export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

export function parseBody(bytes: Uint8Array, contentType: string | null): ParsedBody {
  const size = bytes.byteLength;
  if (size === 0) return { kind: 'empty', size: 0, truncated: false };

  const ct = (contentType ?? '').toLowerCase().split(';')[0]!.trim();
  const rawCt = (contentType ?? '').toLowerCase();
  const text = decodeUtf8(bytes);

  if (rawCt.includes('multipart/form-data')) {
    if (text === null) return binaryResult(bytes);
    return {
      kind: 'multipart',
      text,
      parts: parseMultipartParts(text, rawCt),
      size,
      truncated: false,
    };
  }

  if (ct === 'application/x-www-form-urlencoded') {
    if (text === null) return binaryResult(bytes);
    return { kind: 'form', text, size, truncated: false };
  }

  if (ct.includes('json') || ct === 'application/json' || ct.endsWith('+json')) {
    if (text === null) return binaryResult(bytes);
    return { kind: 'json', text, size, truncated: false };
  }

  if (ct.includes('xml') || ct.endsWith('+xml') || ct === 'text/html') {
    if (text === null) return binaryResult(bytes);
    return { kind: 'xml', text, size, truncated: false };
  }

  if (ct.startsWith('text/') || ct === 'application/javascript' || ct === 'application/graphql') {
    if (text === null) return binaryResult(bytes);
    return { kind: 'text', text, size, truncated: false };
  }

  // Unknown / missing content type: sniff the payload instead of trusting it.
  if (text !== null) {
    const trimmed = text.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        JSON.parse(trimmed);
        return { kind: 'json', text, size, truncated: false };
      } catch {
        /* fall through to text */
      }
    }
    if (trimmed.startsWith('<')) return { kind: 'xml', text, size, truncated: false };
    if (looksLikeForm(text)) return { kind: 'form', text, size, truncated: false };
    return { kind: 'text', text, size, truncated: false };
  }

  return binaryResult(bytes);
}

function binaryResult(bytes: Uint8Array): ParsedBody {
  const preview = bytes.subarray(0, LIMITS.binaryPreviewBytes);
  return {
    kind: 'binary',
    base64: bytesToBase64(bytes),
    hexPreview: bytesToHex(preview),
    size: bytes.byteLength,
    truncated: false,
  };
}

function looksLikeForm(text: string): boolean {
  if (text.length > 4096) return false;
  if (!text.includes('=') || /[<>{}\s]/.test(text)) return false;
  return text.split('&').every((segment) => /^[^=&\s]+=/.test(segment));
}

const utf8Encoder = new TextEncoder();

export function parseMultipartParts(text: string, contentType: string): MultipartPart[] {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch ? (boundaryMatch[1] ?? boundaryMatch[2])!.trim() : null;
  if (!boundary) return [];

  const parts: MultipartPart[] = [];
  const segments = text.split(`--${boundary}`);
  for (const segment of segments) {
    if (!segment || segment.startsWith('--') || segment.trim() === '') continue;
    const headerEnd =
      segment.indexOf('\r\n\r\n') >= 0 ? segment.indexOf('\r\n\r\n') : segment.indexOf('\n\n');
    if (headerEnd < 0) continue;
    const headerText = segment.slice(0, headerEnd);
    const bodyText = segment.slice(headerEnd + (segment.indexOf('\r\n\r\n') >= 0 ? 4 : 2));
    const disposition = /content-disposition:([^\r\n]*)/i.exec(headerText)?.[1] ?? '';
    const name = /name="([^"]*)"/i.exec(disposition)?.[1] ?? '';
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
    const partContentType = /content-type:([^\r\n]*)/i.exec(headerText)?.[1]?.trim() ?? null;
    if (!name && !filename) continue;
    const trimmedBody = bodyText.replace(/\r?\n$/, '');
    const size = utf8Encoder.encode(trimmedBody).byteLength;
    const preview = trimmedBody.slice(0, 200);
    parts.push({
      name,
      filename,
      contentType: partContentType,
      size,
      preview,
      truncated: trimmedBody.length > 200,
    });
    if (parts.length >= 50) break;
  }
  return parts;
}
