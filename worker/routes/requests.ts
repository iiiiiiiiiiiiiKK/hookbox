import type { BodyKind, ListRequestsResponse, RequestDetail } from '../../shared/types';
import { LIMITS } from '../env';
import type { Env } from '../env';
import { requireInbox } from '../lib/auth';
import { HttpError, clampInt, jsonResponse } from '../lib/http';
import {
  clearRequests,
  deleteRequest,
  getRequestRow,
  listRequests,
  toInboxPublic,
  toRequestDetail,
} from '../lib/store';
import { webhookUrlFor } from './inboxes';

const BODY_KINDS: BodyKind[] = ['empty', 'json', 'xml', 'form', 'multipart', 'text', 'binary'];

const SUPPORTED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function parseMethods(url: URL): string[] | undefined {
  const raw = [
    ...url.searchParams.getAll('method'),
    ...(url.searchParams.get('methods') ?? '').split(','),
  ]
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0);
  if (raw.length === 0) return undefined;
  for (const method of raw) {
    if (!SUPPORTED_METHODS.has(method)) {
      throw new HttpError(400, 'invalid_method_filter', `Unsupported method filter: ${method}`);
    }
  }
  return [...new Set(raw)];
}

function parseTime(value: string | null, name: string): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.trunc(numeric);
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  throw new HttpError(400, 'invalid_time_filter', `${name} must be a timestamp in milliseconds`);
}

export async function handleListRequests(
  request: Request,
  env: Env,
  url: URL,
  inboxId: string,
): Promise<Response> {
  await requireInbox(request, env, inboxId);

  const contentTypeParam = url.searchParams.get('contentType');
  let contentType: BodyKind | undefined;
  if (contentTypeParam) {
    const candidate = contentTypeParam.trim().toLowerCase() as BodyKind;
    if (!BODY_KINDS.includes(candidate)) {
      throw new HttpError(
        400,
        'invalid_content_type_filter',
        `contentType must be one of ${BODY_KINDS.join(', ')}`,
      );
    }
    contentType = candidate;
  }

  const path = url.searchParams.get('path') ?? undefined;
  const keyword = url.searchParams.get('q') ?? undefined;

  const response: ListRequestsResponse = await listRequests(env.DB, inboxId, {
    methods: parseMethods(url),
    contentType,
    pathContains: path && path.trim().length > 0 ? path.trim().slice(0, 200) : undefined,
    keyword: keyword && keyword.trim().length > 0 ? keyword.trim().slice(0, 200) : undefined,
    since: parseTime(url.searchParams.get('since'), 'since'),
    until: parseTime(url.searchParams.get('until'), 'until'),
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: clampInt(url.searchParams.get('limit'), 1, LIMITS.listPageSizeMax, 50),
  });

  return jsonResponse(response);
}

export async function handleGetRequest(
  request: Request,
  env: Env,
  url: URL,
  inboxId: string,
  requestId: string,
): Promise<Response> {
  await requireInbox(request, env, inboxId);
  const row = await getRequestRow(env.DB, inboxId, requestId);
  if (!row) throw new HttpError(404, 'request_not_found', 'Request not found in this inbox');
  const reveal =
    url.searchParams.get('reveal') === '1' || url.searchParams.get('reveal') === 'true';
  const detail: RequestDetail = toRequestDetail(row, { reveal });
  return jsonResponse({ request: detail });
}

export async function handleDeleteRequest(
  request: Request,
  env: Env,
  inboxId: string,
  requestId: string,
): Promise<Response> {
  await requireInbox(request, env, inboxId);
  const deleted = await deleteRequest(env.DB, inboxId, requestId);
  if (!deleted) throw new HttpError(404, 'request_not_found', 'Request not found in this inbox');
  return jsonResponse({ ok: true, deleted: requestId });
}

export async function handleClearRequests(
  request: Request,
  env: Env,
  inboxId: string,
): Promise<Response> {
  await requireInbox(request, env, inboxId);
  const deleted = await clearRequests(env.DB, inboxId);
  return jsonResponse({ ok: true, deleted });
}

export async function handleExport(
  request: Request,
  env: Env,
  url: URL,
  inboxId: string,
): Promise<Response> {
  const inbox = await requireInbox(request, env, inboxId);
  const reveal = url.searchParams.get('reveal') === '1';
  const list = await listRequests(env.DB, inboxId, { limit: LIMITS.listPageSizeMax });
  const details: RequestDetail[] = [];
  for (const summary of list.requests) {
    const row = await getRequestRow(env.DB, inboxId, summary.id);
    if (row) details.push(toRequestDetail(row, { reveal }));
  }

  return jsonResponse(
    {
      exportedAt: new Date().toISOString(),
      exportFormat: 'hookbox-json',
      exportVersion: 1,
      warning: reveal
        ? 'This export contains unredacted data, including any secrets your senders transmitted.'
        : 'Sensitive headers and fields are redacted in this export. Add ?reveal=1 for raw data.',
      inbox: toInboxPublic(inbox, webhookUrlFor(env, url, inbox.id)),
      requestCount: details.length,
      truncated: list.total > details.length,
      requests: details,
    },
    {
      headers: {
        'content-disposition': `attachment; filename="hookbox-${inbox.id}-${Date.now()}.json"`,
      },
    },
  );
}
