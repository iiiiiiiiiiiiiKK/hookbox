import { constantTimeEqual, hmacSha256Hex, isBase64Url } from './crypto';
import { HttpError } from './http';
import { getInbox, inboxStatus, type InboxRow } from './store';
import type { Env } from '../env';

export const MIN_TOKEN_LENGTH = 20;

export function requirePepper(env: Env): string {
  const pepper = (env.AUTH_PEPPER ?? '').trim();
  if (pepper.length < 16) {
    throw new HttpError(
      500,
      'server_misconfigured',
      'AUTH_PEPPER is missing or too short on the server; inbox access is disabled',
    );
  }
  return pepper;
}

export async function hashToken(pepper: string, inboxId: string, token: string): Promise<string> {
  return hmacSha256Hex(pepper, `${inboxId}:${token}`);
}

export async function hashCreator(pepper: string, ip: string | null): Promise<string | null> {
  if (!ip) return null;
  return (await hmacSha256Hex(pepper, `creator:${ip}`)).slice(0, 32);
}

export async function hashSourceIp(pepper: string, ip: string | null): Promise<string | null> {
  if (!ip) return null;
  return (await hmacSha256Hex(pepper, `source:${ip}`)).slice(0, 16);
}

export function extractToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) return match[1]!.trim();
  }
  const custom = request.headers.get('x-inbox-token');
  if (custom) return custom.trim();
  return null;
}

/**
 * Loads an inbox and verifies the caller's token.
 * Returns 404/410/401 rather than leaking whether a guessed id exists.
 */
export async function requireInbox(
  request: Request,
  env: Env,
  inboxId: string,
  now = Date.now(),
): Promise<InboxRow> {
  const pepper = requirePepper(env);
  if (!inboxId || inboxId.length < 8 || !isBase64Url(inboxId)) {
    throw new HttpError(404, 'inbox_not_found', 'Inbox not found');
  }

  const inbox = await getInbox(env.DB, inboxId);
  if (!inbox) throw new HttpError(404, 'inbox_not_found', 'Inbox not found');

  const token = extractToken(request);
  if (!token) {
    throw new HttpError(
      401,
      'missing_token',
      'Missing inbox token (Authorization: Bearer <token>)',
    );
  }
  if (token.length < MIN_TOKEN_LENGTH || !isBase64Url(token)) {
    throw new HttpError(401, 'invalid_token', 'Inbox token is not valid');
  }

  const expected = await hashToken(pepper, inboxId, token);
  if (!constantTimeEqual(expected, inbox.token_hash)) {
    throw new HttpError(401, 'invalid_token', 'Inbox token is not valid');
  }

  const status = inboxStatus(inbox, now);
  if (status === 'deleted') {
    throw new HttpError(410, 'inbox_deleted', 'This inbox was deleted');
  }
  if (status === 'expired') {
    throw new HttpError(410, 'inbox_expired', 'This inbox expired; create a new one');
  }

  return inbox;
}

/** Public (unauthenticated) lookup used by the webhook receiver. */
export async function loadLiveInbox(
  env: Env,
  inboxId: string,
  now = Date.now(),
): Promise<InboxRow> {
  if (!inboxId || inboxId.length < 8 || !isBase64Url(inboxId)) {
    throw new HttpError(404, 'inbox_not_found', 'Inbox not found');
  }
  const inbox = await getInbox(env.DB, inboxId);
  if (!inbox) throw new HttpError(404, 'inbox_not_found', 'Inbox not found');
  const status = inboxStatus(inbox, now);
  if (status === 'deleted') throw new HttpError(410, 'inbox_deleted', 'This inbox was deleted');
  if (status === 'expired') {
    throw new HttpError(410, 'inbox_expired', 'This inbox expired and no longer accepts requests');
  }
  return inbox;
}
