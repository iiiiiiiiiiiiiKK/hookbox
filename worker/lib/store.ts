import type {
  BodyKind,
  InboxPublic,
  InboxStatus,
  ListRequestsResponse,
  Pair,
  RequestDetail,
  RequestSummary,
} from '../../shared/types';
import { LIMITS } from '../env';
import { randomId } from './crypto';
import { decodeCursor, encodeCursor } from './cursor';
import { HttpError } from './http';
import {
  isSensitiveField,
  maskPairs,
  redactForm,
  redactJson,
  redactMultipart,
  redactQueryPairs,
} from './masking';

export interface InboxRow {
  id: string;
  token_hash: string;
  created_at: number;
  expires_at: number;
  status: InboxStatus;
  request_count: number;
  storage_bytes: number;
  creator_hash: string | null;
  label: string | null;
}

export interface RequestRow {
  id: string;
  inbox_id: string;
  method: string;
  path: string;
  query: string;
  headers: string;
  body_text: string | null;
  body_b64: string | null;
  body_kind: BodyKind;
  body_truncated: number;
  content_type: string | null;
  body_size: number;
  source_ip_hash: string | null;
  user_agent: string | null;
  status_code: number;
  received_at: number;
}

export interface ListFilters {
  methods?: string[];
  contentType?: string;
  pathContains?: string;
  keyword?: string;
  since?: number;
  until?: number;
  cursor?: string;
  limit: number;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function isExpired(row: InboxRow, now = Date.now()): boolean {
  return row.expires_at <= now;
}

export function inboxStatus(row: InboxRow, now = Date.now()): InboxStatus {
  if (row.status === 'deleted') return 'deleted';
  return isExpired(row, now) ? 'expired' : 'active';
}

export function toInboxPublic(row: InboxRow, webhookUrl: string, now = Date.now()): InboxPublic {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: inboxStatus(row, now),
    requestCount: row.request_count,
    storageBytes: row.storage_bytes,
    webhookUrl,
  };
}

export async function getInbox(db: D1Database, id: string): Promise<InboxRow | null> {
  const row = await db.prepare('SELECT * FROM inboxes WHERE id = ?1').bind(id).first<InboxRow>();
  return row ?? null;
}

export async function insertInbox(
  db: D1Database,
  inbox: {
    id: string;
    tokenHash: string;
    createdAt: number;
    expiresAt: number;
    creatorHash: string | null;
    label: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO inboxes (id, token_hash, created_at, expires_at, status, request_count, storage_bytes, creator_hash, label)
       VALUES (?1, ?2, ?3, ?4, 'active', 0, 0, ?5, ?6)`,
    )
    .bind(
      inbox.id,
      inbox.tokenHash,
      inbox.createdAt,
      inbox.expiresAt,
      inbox.creatorHash,
      inbox.label,
    )
    .run();
}

export async function countInboxesByCreatorSince(
  db: D1Database,
  creatorHash: string,
  since: number,
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM inboxes WHERE creator_hash = ?1 AND created_at >= ?2')
    .bind(creatorHash, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function extendInbox(db: D1Database, id: string, expiresAt: number): Promise<void> {
  await db.prepare('UPDATE inboxes SET expires_at = ?2 WHERE id = ?1').bind(id, expiresAt).run();
}

export async function hardDeleteInbox(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM requests WHERE inbox_id = ?1').bind(id),
    db.prepare('DELETE FROM inboxes WHERE id = ?1').bind(id),
  ]);
}

export interface NewRequestRow {
  inboxId: string;
  method: string;
  path: string;
  query: Pair[];
  headers: Pair[];
  bodyText: string | null;
  bodyB64: string | null;
  bodyKind: BodyKind;
  contentType: string | null;
  bodySize: number;
  sourceIpHash: string | null;
  userAgent: string | null;
  receivedAt: number;
}

/** Inserts a webhook request and updates the inbox counters in one transaction. */
export async function insertRequest(db: D1Database, input: NewRequestRow): Promise<string> {
  const id = randomId(9);
  await db.batch([
    db
      .prepare(
        `INSERT INTO requests (id, inbox_id, method, path, query, headers, body_text, body_b64, body_kind,
           body_truncated, content_type, body_size, source_ip_hash, user_agent, status_code, received_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11, ?12, ?13, 200, ?14)`,
      )
      .bind(
        id,
        input.inboxId,
        input.method,
        input.path,
        JSON.stringify(input.query),
        JSON.stringify(input.headers),
        input.bodyText,
        input.bodyB64,
        input.bodyKind,
        input.contentType,
        input.bodySize,
        input.sourceIpHash,
        input.userAgent,
        input.receivedAt,
      ),
    db
      .prepare(
        `UPDATE inboxes
           SET request_count = request_count + 1,
               storage_bytes = storage_bytes + ?2
         WHERE id = ?1`,
      )
      .bind(input.inboxId, input.bodySize),
  ]);
  return id;
}

function rowToSummary(row: RequestRow): RequestSummary {
  let queryCount = 0;
  let headerCount = 0;
  try {
    queryCount = (JSON.parse(row.query) as Pair[]).length;
  } catch {
    queryCount = 0;
  }
  try {
    headerCount = (JSON.parse(row.headers) as Pair[]).length;
  } catch {
    headerCount = 0;
  }
  return {
    id: row.id,
    method: row.method,
    path: row.path,
    receivedAt: row.received_at,
    bodyKind: row.body_kind,
    bodySize: row.body_size,
    contentType: row.content_type,
    statusCode: row.status_code,
    queryPairCount: queryCount,
    headerPairCount: headerCount,
  };
}

export async function listRequests(
  db: D1Database,
  inboxId: string,
  filters: ListFilters,
): Promise<ListRequestsResponse> {
  const where: string[] = ['inbox_id = ?1'];
  const params: unknown[] = [inboxId];
  let index = 2;

  if (filters.methods && filters.methods.length > 0) {
    const placeholders = filters.methods.map(() => `?${index++}`);
    where.push(`method IN (${placeholders.join(', ')})`);
    params.push(...filters.methods.map((method) => method.toUpperCase()));
  }
  if (filters.contentType) {
    where.push(`body_kind = ?${index++}`);
    params.push(filters.contentType);
  }
  if (filters.pathContains) {
    where.push(`path LIKE ?${index++} ESCAPE '\\'`);
    params.push(`%${escapeLike(filters.pathContains)}%`);
  }
  if (filters.keyword) {
    const needle = `%${escapeLike(filters.keyword)}%`;
    where.push(
      `(path LIKE ?${index} ESCAPE '\\' OR IFNULL(body_text, '') LIKE ?${index} ESCAPE '\\' OR headers LIKE ?${index} ESCAPE '\\')`,
    );
    params.push(needle);
    index += 1;
  }
  if (filters.since !== undefined) {
    where.push(`received_at >= ?${index++}`);
    params.push(filters.since);
  }
  if (filters.until !== undefined) {
    where.push(`received_at <= ?${index++}`);
    params.push(filters.until);
  }

  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null;
  if (filters.cursor && !cursor) {
    throw new HttpError(400, 'invalid_cursor', 'Pagination cursor is invalid');
  }
  const cursorClause = cursor
    ? ` AND (received_at < ?${index} OR (received_at = ?${index} AND id < ?${index + 1}))`
    : '';
  const cursorParams = cursor ? [cursor.receivedAt, cursor.id] : [];

  const limit = Math.min(LIMITS.listPageSizeMax, Math.max(1, filters.limit));
  const sql = `SELECT * FROM requests WHERE ${where.join(' AND ')}${cursorClause}
    ORDER BY received_at DESC, id DESC LIMIT ?${index + cursorParams.length}`;

  const listParams = [...params, ...cursorParams, limit + 1];
  const result = await db
    .prepare(sql)
    .bind(...listParams)
    .all<RequestRow>();
  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  const totalRow = await db
    .prepare('SELECT COUNT(*) AS n FROM requests WHERE inbox_id = ?1')
    .bind(inboxId)
    .first<{ n: number }>();

  const filteredRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM requests WHERE ${where.join(' AND ')}`)
    .bind(...params)
    .first<{ n: number }>();

  return {
    requests: page.map(rowToSummary),
    nextCursor: hasMore && last ? encodeCursor(last.received_at, last.id) : null,
    total: totalRow?.n ?? 0,
    filtered: filteredRow?.n ?? page.length,
  };
}

export async function listRequestsAfterCursor(
  db: D1Database,
  inboxId: string,
  cursor: { receivedAt: number; id: string } | null,
  limit: number,
): Promise<{ rows: RequestSummary[]; cursor: { receivedAt: number; id: string } | null }> {
  const result = cursor
    ? await db
        .prepare(
          `SELECT * FROM requests
           WHERE inbox_id = ?1 AND (received_at > ?2 OR (received_at = ?2 AND id > ?3))
           ORDER BY received_at ASC, id ASC LIMIT ?4`,
        )
        .bind(inboxId, cursor.receivedAt, cursor.id, limit)
        .all<RequestRow>()
    : await db
        .prepare(
          `SELECT * FROM requests WHERE inbox_id = ?1 ORDER BY received_at ASC, id ASC LIMIT ?2`,
        )
        .bind(inboxId, limit)
        .all<RequestRow>();

  const rows = result.results ?? [];
  const last = rows[rows.length - 1];
  return {
    rows: rows.map(rowToSummary),
    cursor: last ? { receivedAt: last.received_at, id: last.id } : cursor,
  };
}

export async function getRequestRow(
  db: D1Database,
  inboxId: string,
  requestId: string,
): Promise<RequestRow | null> {
  const row = await db
    .prepare('SELECT * FROM requests WHERE inbox_id = ?1 AND id = ?2')
    .bind(inboxId, requestId)
    .first<RequestRow>();
  return row ?? null;
}

export interface DetailOptions {
  reveal: boolean;
}

export function toRequestDetail(row: RequestRow, options: DetailOptions): RequestDetail {
  const summary = rowToSummary(row);
  const query = JSON.parse(row.query) as Pair[];
  const headers = JSON.parse(row.headers) as Pair[];

  const detail: RequestDetail = {
    ...summary,
    query: redactQueryPairs(query, options.reveal),
    headers: maskPairs(headers, options.reveal),
    sourceIp: row.source_ip_hash,
    userAgent: row.user_agent,
    revealed: options.reveal,
    completed: true,
    body: {
      kind: row.body_kind,
      size: row.body_size,
      truncated: row.body_truncated === 1,
      redacted: false,
    },
  };

  if (row.body_kind === 'binary') {
    // Binary payloads are only transferred as base64 when explicitly revealed.
    detail.body.base64 = options.reveal ? (row.body_b64 ?? undefined) : undefined;
    if (!options.reveal) {
      detail.body.redacted = true;
      detail.body.hexPreview = row.body_b64 ? undefined : undefined;
    }
    return detail;
  }

  const text = row.body_text ?? '';
  detail.body.text = text;
  if (options.reveal || text.length === 0) return detail;

  let redacted = { text, redacted: false };
  if (row.body_kind === 'json') redacted = redactJson(text);
  else if (row.body_kind === 'form') redacted = redactForm(text);
  else if (row.body_kind === 'multipart') redacted = redactMultipart(text);

  detail.body.text = redacted.text;
  detail.body.redacted = redacted.redacted;

  if (row.body_kind === 'multipart') {
    detail.body.parts = undefined;
    try {
      const partsMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(row.content_type ?? '');
      if (partsMatch) {
        const boundary = (partsMatch[1] ?? partsMatch[2])!.trim();
        detail.body.parts = extractPartMetadata(redacted.text, boundary).map((part) => ({
          ...part,
          preview: isSensitiveField(part.name) && !options.reveal ? '••••••' : part.preview,
        }));
      }
    } catch {
      detail.body.parts = undefined;
    }
  }

  return detail;
}

function extractPartMetadata(text: string, boundary: string) {
  const parts: Array<{
    name: string;
    filename: string | null;
    contentType: string | null;
    size: number;
    preview: string;
    truncated: boolean;
  }> = [];
  for (const segment of text.split(`--${boundary}`)) {
    if (!segment || segment.startsWith('--')) continue;
    const splitIndex =
      segment.indexOf('\r\n\r\n') >= 0 ? segment.indexOf('\r\n\r\n') : segment.indexOf('\n\n');
    if (splitIndex < 0) continue;
    const headerText = segment.slice(0, splitIndex);
    const body = segment
      .slice(splitIndex + (segment.indexOf('\r\n\r\n') >= 0 ? 4 : 2))
      .replace(/\r?\n$/, '');
    const disposition = /content-disposition:([^\r\n]*)/i.exec(headerText)?.[1] ?? '';
    const name = /name="([^"]*)"/i.exec(disposition)?.[1] ?? '';
    if (!name) continue;
    parts.push({
      name,
      filename: /filename="([^"]*)"/i.exec(disposition)?.[1] ?? null,
      contentType: /content-type:([^\r\n]*)/i.exec(headerText)?.[1]?.trim() ?? null,
      size: new TextEncoder().encode(body).byteLength,
      preview: body.slice(0, 200),
      truncated: body.length > 200,
    });
    if (parts.length >= 50) break;
  }
  return parts;
}

export async function deleteRequest(
  db: D1Database,
  inboxId: string,
  requestId: string,
): Promise<boolean> {
  const row = await getRequestRow(db, inboxId, requestId);
  if (!row) return false;
  await db.batch([
    db.prepare('DELETE FROM requests WHERE inbox_id = ?1 AND id = ?2').bind(inboxId, requestId),
    db
      .prepare(
        `UPDATE inboxes SET request_count = MAX(request_count - 1, 0),
          storage_bytes = MAX(storage_bytes - ?2, 0) WHERE id = ?1`,
      )
      .bind(inboxId, row.body_size),
  ]);
  return true;
}

export async function clearRequests(db: D1Database, inboxId: string): Promise<number> {
  const countRow = await db
    .prepare('SELECT COUNT(*) AS n FROM requests WHERE inbox_id = ?1')
    .bind(inboxId)
    .first<{ n: number }>();
  await db.batch([
    db.prepare('DELETE FROM requests WHERE inbox_id = ?1').bind(inboxId),
    db
      .prepare('UPDATE inboxes SET request_count = 0, storage_bytes = 0 WHERE id = ?1')
      .bind(inboxId),
  ]);
  return countRow?.n ?? 0;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  resetAt: number;
  retryAfterMs: number;
}

/**
 * Fixed-window counter stored in D1. Cheap (one upsert) and survives Worker
 * restarts, unlike in-memory counters.
 */
export async function hitRateLimit(
  db: D1Database,
  bucket: string,
  windowMs: number,
  limit: number,
  now = Date.now(),
): Promise<RateLimitResult> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;
  const [upsert, read] = await db.batch([
    db
      .prepare(
        `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?1, ?2, 1)
         ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1`,
      )
      .bind(bucket, windowStart),
    db
      .prepare('SELECT count FROM rate_limits WHERE bucket = ?1 AND window_start = ?2')
      .bind(bucket, windowStart),
  ]);

  void upsert;
  const count = Number((read.results?.[0] as { count?: number } | undefined)?.count ?? 1);
  return {
    allowed: count <= limit,
    count,
    limit,
    resetAt,
    retryAfterMs: Math.max(0, resetAt - now),
  };
}

export async function sweepExpired(
  db: D1Database,
  now = Date.now(),
): Promise<{
  inboxes: number;
  requests: number;
  rateLimits: number;
}> {
  const expired = await db
    .prepare(`SELECT id FROM inboxes WHERE status = 'deleted' OR expires_at <= ?1 LIMIT ?2`)
    .bind(now, LIMITS.sweepBatchSize)
    .all<{ id: string }>();

  const ids = (expired.results ?? []).map((row) => row.id);
  let deletedRequests = 0;
  if (ids.length > 0) {
    const placeholders = ids.map((_, index) => `?${index + 1}`).join(', ');
    const counts = await db
      .prepare(`SELECT COUNT(*) AS n FROM requests WHERE inbox_id IN (${placeholders})`)
      .bind(...ids)
      .first<{ n: number }>();
    deletedRequests = counts?.n ?? 0;
    const statements = [
      db.prepare(`DELETE FROM requests WHERE inbox_id IN (${placeholders})`).bind(...ids),
      db.prepare(`DELETE FROM inboxes WHERE id IN (${placeholders})`).bind(...ids),
    ];
    await db.batch(statements);
  }

  const rateLimits = await db
    .prepare('DELETE FROM rate_limits WHERE window_start < ?1')
    .bind(now - LIMITS.rateLimitRetentionMs)
    .run();

  return {
    inboxes: ids.length,
    requests: deletedRequests,
    rateLimits: rateLimits.meta?.changes ?? 0,
  };
}
