import type {
  CreateInboxResponse,
  ExtendInboxResponse,
  InboxPublic,
  ListRequestsResponse,
  MetaResponse,
  ReplayResult,
  RequestDetail,
} from '../../shared/types';

export class ApiError extends Error {
  status: number;
  code: string;
  retryAfterMs?: number;

  constructor(status: number, code: string, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

interface RequestOptions {
  method?: string;
  token?: string;
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    credentials: 'omit',
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (
      payload as { error?: { code?: string; message?: string; retryAfterMs?: number } } | null
    )?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'request_failed',
      error?.message ?? `Request failed with status ${response.status}`,
      error?.retryAfterMs,
    );
  }

  return payload as T;
}

export interface ListParams {
  cursor?: string | null;
  limit?: number;
  methods?: string[];
  contentType?: string;
  path?: string;
  keyword?: string;
  since?: number;
  until?: number;
}

function listQuery(params: ListParams): string {
  const search = new URLSearchParams();
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.limit) search.set('limit', String(params.limit));
  for (const method of params.methods ?? []) search.append('method', method);
  if (params.contentType) search.set('contentType', params.contentType);
  if (params.path) search.set('path', params.path);
  if (params.keyword) search.set('q', params.keyword);
  if (params.since) search.set('since', String(params.since));
  if (params.until) search.set('until', String(params.until));
  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
}

export const api = {
  meta(): Promise<MetaResponse> {
    return request<MetaResponse>('/api/meta');
  },

  createInbox(ttlHours: number, label?: string): Promise<CreateInboxResponse> {
    return request<CreateInboxResponse>('/api/inboxes', {
      method: 'POST',
      body: { ttlHours, ...(label ? { label } : {}) },
    });
  },

  getInbox(id: string, token: string): Promise<{ inbox: InboxPublic }> {
    return request<{ inbox: InboxPublic }>(`/api/inboxes/${id}`, { token });
  },

  extendInbox(id: string, token: string, hours: number): Promise<ExtendInboxResponse> {
    return request<ExtendInboxResponse>(`/api/inboxes/${id}/extend`, {
      method: 'POST',
      token,
      body: { hours },
    });
  },

  deleteInbox(id: string, token: string): Promise<{ ok: boolean; requests: number }> {
    return request<{ ok: boolean; requests: number }>(`/api/inboxes/${id}`, {
      method: 'DELETE',
      token,
    });
  },

  listRequests(id: string, token: string, params: ListParams = {}): Promise<ListRequestsResponse> {
    return request<ListRequestsResponse>(`/api/inboxes/${id}/requests${listQuery(params)}`, {
      token,
    });
  },

  getRequest(
    id: string,
    token: string,
    requestId: string,
    reveal = false,
  ): Promise<{ request: RequestDetail }> {
    const suffix = reveal ? '?reveal=1' : '';
    return request<{ request: RequestDetail }>(
      `/api/inboxes/${id}/requests/${requestId}${suffix}`,
      {
        token,
      },
    );
  },

  deleteRequest(id: string, token: string, requestId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/api/inboxes/${id}/requests/${requestId}`, {
      method: 'DELETE',
      token,
    });
  },

  clearRequests(id: string, token: string): Promise<{ ok: boolean; deleted: number }> {
    return request<{ ok: boolean; deleted: number }>(`/api/inboxes/${id}/requests`, {
      method: 'DELETE',
      token,
    });
  },

  replay(
    id: string,
    token: string,
    requestId: string,
    targetUrl: string,
    includeSensitiveHeaders: boolean,
  ): Promise<{ replay: ReplayResult }> {
    return request<{ replay: ReplayResult }>(`/api/inboxes/${id}/requests/${requestId}/replay`, {
      method: 'POST',
      token,
      body: { targetUrl, includeSensitiveHeaders },
    });
  },

  exportUrl(id: string, reveal: boolean): string {
    return `/api/inboxes/${id}/export${reveal ? '?reveal=1' : ''}`;
  },

  streamUrl(id: string, cursor: string | null): string {
    const search = new URLSearchParams();
    if (cursor) search.set('cursor', cursor);
    const query = search.toString();
    return `/api/inboxes/${id}/stream${query ? `?${query}` : ''}`;
  },
};
