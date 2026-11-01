import type { Pair } from '../../shared/types';

export const REDACTED = '••••••';

/**
 * Headers that never leave the API in cleartext unless the caller explicitly
 * asks for the raw payload (`?reveal=1`).
 */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'apikey',
  'x-auth-token',
  'x-access-token',
  'x-session-token',
  'x-csrf-token',
  'x-xsrf-token',
  'x-stripe-signature',
  'stripe-signature',
  'x-hub-signature',
  'x-hub-signature-256',
  'x-slack-signature',
  'x-twilio-signature',
  'x-shopify-hmac-sha256',
  'x-webhook-signature',
  'x-signature',
  'webhook-signature',
  'x-amz-security-token',
  'private-token',
  'x-gitlab-token',
  'x-telegram-bot-api-secret-token',
  'x-vercel-signature',
  'x-github-delivery-token',
  'cf-access-jwt-assertion',
  // Raw client IPs are PII. The Overview tab shows a hashed value instead.
  'cf-connecting-ip',
  'cf-pseudo-ipv4',
  'true-client-ip',
  'x-real-ip',
  'x-forwarded-for',
  'x-client-ip',
]);

const SENSITIVE_KEY_PATTERN =
  /(pass(word|wd|phrase)?|secret|token|api[-_]?key|apikey|access[-_]?key|private[-_]?key|authorization|auth|cookie|session|signature|card[-_]?number|cardnumber|cvv2?|cvc|ssn|social[-_]?security|otp|one[-_]?time|pin|credential|client[-_]?secret|refresh[-_]?token|id[-_]?token)/i;

/** Keys that look sensitive but are harmless metadata, never redacted. */
const SAFE_KEY_ALLOWLIST = new Set([
  'token_type',
  'tokentype',
  'session_count',
  'auth_method',
  'authmethod',
  'token_expires_in',
  'authorized',
  'auth_required',
  'pincode_format',
]);

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.trim().toLowerCase());
}

export function isSensitiveField(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, '_');
  if (SAFE_KEY_ALLOWLIST.has(normalized)) return false;
  return SENSITIVE_KEY_PATTERN.test(normalized);
}

export function maskPairs(pairs: Pair[], revealed: boolean): Pair[] {
  if (revealed) return pairs;
  return pairs.map(([key, value]) => [
    key,
    isSensitiveHeader(key) || (isSensitiveField(key) && looksLikeSecret(key, value))
      ? REDACTED
      : value,
  ]);
}

/**
 * Header names such as `x-auth-mode` should survive. Only redact header-like
 * keys when the value is long enough to plausibly be a credential.
 */
function looksLikeSecret(key: string, value: string): boolean {
  if (isSensitiveHeader(key)) return true;
  return value.length >= 8;
}

export interface RedactedPayload {
  text: string;
  redacted: boolean;
}

/** Redacts obviously sensitive values inside a JSON payload, preserving structure. */
export function redactJson(text: string): RedactedPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { text, redacted: false };
  }
  let touched = false;
  const walk = (value: unknown, keyHint: string | null): unknown => {
    if (Array.isArray(value)) return value.map((item) => walk(item, keyHint));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        out[key] = walk(child, key);
      }
      return out;
    }
    if (
      keyHint &&
      (typeof value === 'string' || typeof value === 'number') &&
      isSensitiveField(keyHint)
    ) {
      const str = String(value);
      if (str.length >= 6) {
        touched = true;
        return REDACTED;
      }
    }
    return value;
  };
  const result = walk(parsed, null);
  if (!touched) return { text, redacted: false };
  return { text: JSON.stringify(result), redacted: true };
}

/** Redacts sensitive fields in `application/x-www-form-urlencoded` payloads. */
export function redactForm(text: string): RedactedPayload {
  const params = new URLSearchParams(text);
  let touched = false;
  const out = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (isSensitiveField(key) && value.length >= 6) {
      out.append(key, REDACTED);
      touched = true;
    } else {
      out.append(key, value);
    }
  }
  return { text: touched ? out.toString() : text, redacted: touched };
}

/** Redacts the `name`-addressed fields of a multipart body kept as text. */
export function redactMultipart(text: string): RedactedPayload {
  const firstLineEnd = text.indexOf('\r\n');
  const firstLine = firstLineEnd >= 0 ? text.slice(0, firstLineEnd) : text;
  if (!firstLine.startsWith('--')) return { text, redacted: false };

  const boundary = firstLine.slice(2).trim();
  if (boundary.length === 0) return { text, redacted: false };

  const delimiter = `--${boundary}`;
  let touched = false;

  const rebuilt = text.split(delimiter).map((segment) => {
    if (segment.startsWith('--')) return segment; // closing delimiter
    const crlfIndex = segment.indexOf('\r\n\r\n');
    const lfIndex = segment.indexOf('\n\n');
    const separatorIndex = crlfIndex >= 0 ? crlfIndex : lfIndex;
    if (separatorIndex < 0) return segment;

    const separator = crlfIndex >= 0 ? '\r\n\r\n' : '\n\n';
    const headers = segment.slice(0, separatorIndex);
    const body = segment.slice(separatorIndex + separator.length);
    const name = /name="([^"]*)"/i.exec(headers)?.[1] ?? '';
    const isFilePart = /filename="/i.test(headers);
    if (!name || isFilePart || !isSensitiveField(name)) return segment;

    const trimmed = body.replace(/\r?\n$/, '');
    if (trimmed.length < 6) return segment;

    touched = true;
    return `${headers}${separator}${REDACTED}${body.slice(trimmed.length)}`;
  });

  return { text: touched ? rebuilt.join(delimiter) : text, redacted: touched };
}

/** Best-effort masking for free-form text bodies and single query values. */
export function redactQueryPairs(pairs: Pair[], revealed: boolean): Pair[] {
  if (revealed) return pairs;
  return pairs.map(([key, value]) =>
    isSensitiveField(key) && value.length >= 6 ? [key, REDACTED] : [key, value],
  );
}

export function maskUserAgent(ua: string | null): string | null {
  return ua;
}
