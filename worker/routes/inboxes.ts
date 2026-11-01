import type { CreateInboxResponse, ExtendInboxResponse, InboxPublic } from '../../shared/types';
import { INBOX_ID_BYTES, INBOX_TOKEN_BYTES, LIMITS, ttlHoursToMs } from '../env';
import type { Env } from '../env';
import { hashCreator, hashToken, requireInbox, requirePepper } from '../lib/auth';
import { randomId } from '../lib/crypto';
import { clientIp, HttpError, jsonResponse, readJsonBody } from '../lib/http';
import {
  countInboxesByCreatorSince,
  extendInbox,
  hardDeleteInbox,
  hitRateLimit,
  insertInbox,
  toInboxPublic,
  type InboxRow,
} from '../lib/store';

export function publicOrigin(env: Env, url: URL): string {
  const override = (env.PUBLIC_ORIGIN ?? '').trim().replace(/\/+$/, '');
  return override.length > 0 ? override : url.origin;
}

export function webhookUrlFor(env: Env, url: URL, inboxId: string): string {
  return `${publicOrigin(env, url)}/hook/${inboxId}`;
}

function toPublic(env: Env, url: URL, row: InboxRow): InboxPublic {
  return toInboxPublic(row, webhookUrlFor(env, url, row.id));
}

export async function handleCreateInbox(request: Request, env: Env, url: URL): Promise<Response> {
  const pepper = requirePepper(env);
  const payload = await readJsonBody<{ ttlHours?: unknown; label?: unknown }>(request, 4096);

  const ttlHours =
    payload.ttlHours === undefined ? LIMITS.allowedTtlHours[0]! : Number(payload.ttlHours);
  if (!LIMITS.allowedTtlHours.includes(ttlHours)) {
    throw new HttpError(
      400,
      'invalid_ttl',
      `ttlHours must be one of ${LIMITS.allowedTtlHours.join(', ')}`,
    );
  }

  let label: string | null = null;
  if (payload.label !== undefined && payload.label !== null) {
    if (typeof payload.label !== 'string') {
      throw new HttpError(400, 'invalid_label', 'label must be a string');
    }
    const trimmed = payload.label.trim();
    if (trimmed.length > LIMITS.maxLabelLength) {
      throw new HttpError(
        400,
        'invalid_label',
        `label must be at most ${LIMITS.maxLabelLength} characters`,
      );
    }
    label = trimmed.length > 0 ? trimmed : null;
  }

  const now = Date.now();
  const ip = clientIp(request);
  const creatorHash = await hashCreator(pepper, ip);

  if (creatorHash) {
    const perHour = await hitRateLimit(
      env.DB,
      `create:${creatorHash}`,
      60 * 60 * 1000,
      LIMITS.inboxCreatePerIpPerHour,
      now,
    );
    if (!perHour.allowed) {
      throw new HttpError(
        429,
        'rate_limited',
        `Too many inboxes created from this IP (limit ${LIMITS.inboxCreatePerIpPerHour}/hour)`,
        { retryAfterMs: perHour.retryAfterMs },
      );
    }

    const createdToday = await countInboxesByCreatorSince(
      env.DB,
      creatorHash,
      now - LIMITS.inboxCreatePerIpPerDayWindowMs,
    );
    if (createdToday >= LIMITS.inboxCreatePerIpPerDay) {
      throw new HttpError(
        429,
        'inbox_quota_exceeded',
        `Daily inbox quota reached (${LIMITS.inboxCreatePerIpPerDay} per 24h). Try again later.`,
      );
    }
  }

  const id = randomId(INBOX_ID_BYTES);
  const token = randomId(INBOX_TOKEN_BYTES);
  const tokenHash = await hashToken(pepper, id, token);
  const expiresAt = now + ttlHoursToMs(ttlHours);

  await insertInbox(env.DB, { id, tokenHash, createdAt: now, expiresAt, creatorHash, label });

  const row: InboxRow = {
    id,
    token_hash: tokenHash,
    created_at: now,
    expires_at: expiresAt,
    status: 'active',
    request_count: 0,
    storage_bytes: 0,
    creator_hash: creatorHash,
    label,
  };

  const response: CreateInboxResponse = { inbox: toPublic(env, url, row), token };
  return jsonResponse(response, { status: 201 });
}

export async function handleGetInbox(
  request: Request,
  env: Env,
  url: URL,
  inboxId: string,
): Promise<Response> {
  const row = await requireInbox(request, env, inboxId);
  return jsonResponse({ inbox: toPublic(env, url, row) });
}

export async function handleExtendInbox(
  request: Request,
  env: Env,
  url: URL,
  inboxId: string,
): Promise<Response> {
  const row = await requireInbox(request, env, inboxId);
  const payload = await readJsonBody<{ hours?: unknown }>(request, 2048);
  const hours = payload.hours === undefined ? LIMITS.allowedTtlHours[0]! : Number(payload.hours);
  if (!LIMITS.allowedTtlHours.includes(hours)) {
    throw new HttpError(
      400,
      'invalid_ttl',
      `hours must be one of ${LIMITS.allowedTtlHours.join(', ')}`,
    );
  }

  const now = Date.now();
  const hardCap = row.created_at + ttlHoursToMs(LIMITS.maxTtlHours);
  const proposed = Math.min(now + ttlHoursToMs(hours), hardCap);
  if (proposed <= row.expires_at) {
    throw new HttpError(
      409,
      'ttl_capped',
      `Inbox lifetime is already at the ${LIMITS.maxTtlHours}h server maximum`,
      { details: { maxTtlHours: LIMITS.maxTtlHours, expiresAt: row.expires_at } },
    );
  }

  await extendInbox(env.DB, row.id, proposed);
  const updated: InboxRow = { ...row, expires_at: proposed };
  const response: ExtendInboxResponse = {
    inbox: toPublic(env, url, updated),
    extendedByMs: proposed - row.expires_at,
    cappedAt: hardCap,
  };
  return jsonResponse(response);
}

export async function handleDeleteInbox(
  request: Request,
  env: Env,
  inboxId: string,
): Promise<Response> {
  const row = await requireInbox(request, env, inboxId);
  await hardDeleteInbox(env.DB, row.id);
  return jsonResponse({ ok: true, deleted: row.id, requests: row.request_count });
}
