import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ListRequestsResponse, RequestSummary } from '../../shared/types';
import { api, ApiError } from '../lib/api';

export type ConnectionState = 'connecting' | 'live' | 'polling' | 'offline';

export interface Filters {
  methods: string[];
  keyword: string;
  contentType: string;
  path: string;
  sinceMs: number | null;
}

export const EMPTY_FILTERS: Filters = {
  methods: [],
  keyword: '',
  contentType: '',
  path: '',
  sinceMs: null,
};

export function hasActiveFilters(filters: Filters): boolean {
  return (
    filters.methods.length > 0 ||
    filters.keyword.trim().length > 0 ||
    filters.contentType.length > 0 ||
    filters.path.trim().length > 0 ||
    filters.sinceMs !== null
  );
}

interface UseRequestsOptions {
  inboxId: string | null;
  token: string | null;
  filters: Filters;
  enabled: boolean;
}

export interface RequestsState {
  items: RequestSummary[];
  total: number;
  filtered: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  connection: ConnectionState;
  pendingCount: number;
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  removeLocal: (id: string) => void;
  clearLocal: () => void;
  clearPending: () => void;
}

function matchesFilters(item: RequestSummary, filters: Filters): boolean {
  if (filters.methods.length > 0 && !filters.methods.includes(item.method)) return false;
  if (filters.contentType && item.bodyKind !== filters.contentType) return false;
  if (filters.path.trim()) {
    const needle = filters.path.trim().toLowerCase();
    if (!item.path.toLowerCase().includes(needle)) return false;
  }
  if (filters.sinceMs !== null && item.receivedAt < filters.sinceMs) return false;
  // Keyword search needs the request body, which lives server-side: the stream
  // cannot match it reliably, so new arrivals are counted instead of inserted.
  if (filters.keyword.trim().length > 0) return false;
  return true;
}

const PAGE_SIZE = 50;

export function useRequests({
  inboxId,
  token,
  filters,
  enabled,
}: UseRequestsOptions): RequestsState {
  const [items, setItems] = useState<RequestSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [filtered, setFiltered] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [pendingCount, setPendingCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const cursorRef = useRef<string | null>(null);
  cursorRef.current = nextCursor;

  const filterKey = useMemo(
    () =>
      JSON.stringify([
        filters.methods,
        filters.keyword.trim(),
        filters.contentType,
        filters.path.trim(),
        filters.sinceMs,
      ]),
    [filters],
  );

  const applyListResponse = useCallback((response: ListRequestsResponse, append: boolean) => {
    setItems((previous) => {
      if (!append) return response.requests;
      const seen = new Set(previous.map((item) => item.id));
      return [...previous, ...response.requests.filter((item) => !seen.has(item.id))];
    });
    setTotal(response.total);
    setFiltered(response.filtered);
    setNextCursor(response.nextCursor);
  }, []);

  const refresh = useCallback(async () => {
    if (!inboxId || !token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.listRequests(inboxId, token, {
        limit: PAGE_SIZE,
        methods: filters.methods,
        contentType: filters.contentType || undefined,
        path: filters.path.trim() || undefined,
        keyword: filters.keyword.trim() || undefined,
        since: filters.sinceMs ?? undefined,
      });
      applyListResponse(response, false);
      setPendingCount(0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load requests');
    } finally {
      setLoading(false);
    }
  }, [applyListResponse, filters, inboxId, token]);

  const loadMore = useCallback(async () => {
    if (!inboxId || !token || !cursorRef.current || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await api.listRequests(inboxId, token, {
        limit: PAGE_SIZE,
        cursor: cursorRef.current,
        methods: filters.methods,
        contentType: filters.contentType || undefined,
        path: filters.path.trim() || undefined,
        keyword: filters.keyword.trim() || undefined,
        since: filters.sinceMs ?? undefined,
      });
      applyListResponse(response, true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more requests');
    } finally {
      setLoadingMore(false);
    }
  }, [applyListResponse, filters, inboxId, loadingMore, token]);

  // Reset + initial load whenever the inbox or the filter set changes.
  useEffect(() => {
    setItems([]);
    setTotal(0);
    setFiltered(0);
    setNextCursor(null);
    setPendingCount(0);
    if (!inboxId || !token) {
      setConnection('offline');
      return;
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxId, token, filterKey]);

  // Live updates: SSE first, polling as a documented fallback.
  useEffect(() => {
    if (!inboxId || !token || !enabled) {
      setConnection('offline');
      return;
    }

    let cancelled = false;
    let failures = 0;
    let controller: AbortController | null = null;
    let reconnectTimer: number | undefined;
    let pollTimer: number | undefined;
    let cursor: string | null = null;

    const mergeIncoming = (incoming: RequestSummary[]) => {
      if (incoming.length === 0) return;
      const active = filtersRef.current;
      const matching = incoming.filter((item) => matchesFilters(item, active));
      if (matching.length === 0) {
        setPendingCount((count) => count + incoming.length);
        return;
      }
      setItems((previous) => {
        const seen = new Set(previous.map((item) => item.id));
        const fresh = matching.filter((item) => !seen.has(item.id));
        if (fresh.length === 0) return previous;
        return [...fresh.reverse(), ...previous].slice(0, 400);
      });
      setTotal((value) => value + matching.length);
      setFiltered((value) => value + matching.length);
    };

    const startPolling = () => {
      if (pollTimer || cancelled) return;
      setConnection('polling');
      const tick = async () => {
        if (cancelled) return;
        try {
          const response = await api.listRequests(inboxId, token, {
            limit: PAGE_SIZE,
            methods: filtersRef.current.methods,
            contentType: filtersRef.current.contentType || undefined,
            path: filtersRef.current.path.trim() || undefined,
            keyword: filtersRef.current.keyword.trim() || undefined,
            since: filtersRef.current.sinceMs ?? undefined,
          });
          applyListResponse(response, false);
          setPendingCount(0);
        } catch {
          if (!cancelled) setConnection('offline');
        }
      };
      pollTimer = window.setInterval(() => void tick(), 4_000);
    };

    const connect = async () => {
      if (cancelled) return;
      controller = new AbortController();
      setConnection(failures === 0 ? 'connecting' : 'connecting');
      try {
        const response = await fetch(api.streamUrl(inboxId, cursor), {
          headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
          signal: controller.signal,
          credentials: 'omit',
        });
        if (!response.ok || !response.body) throw new Error(`stream failed (${response.status})`);
        setConnection('live');
        failures = 0;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done || cancelled) break;
          buffer += decoder.decode(value, { stream: true });
          let index = buffer.indexOf('\n\n');
          while (index >= 0) {
            const chunk = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            index = buffer.indexOf('\n\n');
            const eventLine = /^event:\s*(.+)$/m.exec(chunk)?.[1]?.trim();
            const dataLine = /^data:\s*(.+)$/m.exec(chunk)?.[1];
            if (!eventLine || !dataLine) continue;
            if (eventLine === 'hello') {
              try {
                const hello = JSON.parse(dataLine) as { cursor: string | null };
                if (hello.cursor) cursor = hello.cursor;
              } catch {
                /* ignore malformed hello */
              }
            } else if (eventLine === 'requests') {
              try {
                const payload = JSON.parse(dataLine) as {
                  requests: RequestSummary[];
                  cursor: string;
                };
                if (payload.cursor) cursor = payload.cursor;
                mergeIncoming(payload.requests);
              } catch {
                /* ignore malformed batch */
              }
            } else if (eventLine === 'stream-error') {
              failures += 1;
            }
          }
        }
        if (!cancelled) {
          reconnectTimer = window.setTimeout(() => void connect(), 250);
        }
      } catch (err) {
        if (cancelled) return;
        failures += 1;
        if (failures >= 3) {
          startPolling();
          return;
        }
        setConnection('connecting');
        reconnectTimer = window.setTimeout(() => void connect(), Math.min(4_000, 400 * failures));
        void err;
      }
    };

    void connect();

    return () => {
      cancelled = true;
      controller?.abort();
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (pollTimer) window.clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxId, token, enabled, filterKey, applyListResponse]);

  const removeLocal = useCallback((id: string) => {
    setItems((previous) => previous.filter((item) => item.id !== id));
    setTotal((value) => Math.max(0, value - 1));
    setFiltered((value) => Math.max(0, value - 1));
  }, []);

  const clearLocal = useCallback(() => {
    setItems([]);
    setTotal(0);
    setFiltered(0);
    setNextCursor(null);
    setPendingCount(0);
  }, []);

  const clearPending = useCallback(() => {
    void refresh();
  }, [refresh]);

  return {
    items,
    total,
    filtered,
    loading,
    loadingMore,
    error,
    connection,
    pendingCount,
    hasMore: nextCursor !== null,
    refresh,
    loadMore,
    removeLocal,
    clearLocal,
    clearPending,
  };
}
