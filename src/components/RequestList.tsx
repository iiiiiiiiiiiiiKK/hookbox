import { useEffect, useRef } from 'react';
import { ArrowDown, Inbox, RefreshCw } from 'lucide-react';
import type { RequestSummary } from '../../shared/types';
import { bodyKindLabel, formatBytes, formatTime, methodStyle, timeAgo } from '../lib/format';

interface RequestListProps {
  items: RequestSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  pendingCount: number;
  onRefresh: () => void;
  onShowPending: () => void;
  webhookUrl: string | null;
  now: number;
}

export function RequestList({
  items,
  selectedId,
  onSelect,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  pendingCount,
  onRefresh,
  onShowPending,
  webhookUrl,
  now,
}: RequestListProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: '120px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] text-muted">
          <Inbox size={13} />
          <span className="font-medium text-slate-300">Requests</span>
          {loading ? <span className="text-muted">· loading…</span> : null}
        </div>
        <div className="flex items-center gap-1">
          {pendingCount > 0 ? (
            <button
              type="button"
              onClick={onShowPending}
              className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-1.5 py-1 text-[10.5px] text-accent transition hover:bg-accent/20"
            >
              <ArrowDown size={11} /> {pendingCount} new
            </button>
          ) : null}
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-md p-1 text-muted transition hover:bg-panel3 hover:text-slate-200"
            title="Refresh"
            aria-label="Refresh request list"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 && !loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-5 py-10 text-center">
            <div className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-panel2 text-muted">
              <Inbox size={16} />
            </div>
            <p className="text-xs text-slate-300">Waiting for the first request</p>
            {webhookUrl ? (
              <div className="w-full rounded-md border border-line/70 bg-ink/60 p-2.5 text-left">
                <p className="mb-1 text-[10px] uppercase tracking-wide text-muted">Try this</p>
                <pre className="mono scroll-thin overflow-x-auto whitespace-pre text-[10.5px] leading-relaxed text-slate-300">
                  {`curl -X POST '${webhookUrl}?hello=world' \\
  -H 'content-type: application/json' \\
  -d '{"event":"test.ping","amount":42,"token":"secret-demo"}'`}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}

        <ul className="divide-y divide-line/60">
          {items.map((item) => {
            const style = methodStyle(item.method);
            const active = item.id === selectedId;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  data-testid="request-item"
                  data-request-id={item.id}
                  data-method={item.method}
                  onClick={() => onSelect(item.id)}
                  className={`w-full px-3 py-2 text-left transition ${
                    active ? 'bg-accent/[0.07]' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`mono shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${style.border} ${style.bg} ${style.text}`}
                    >
                      {item.method}
                    </span>
                    <span className="mono min-w-0 flex-1 truncate text-[11.5px] text-slate-200">
                      {item.path}
                    </span>
                    {active ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 pl-0.5 text-[10px] text-muted">
                    <span className="mono">{formatTime(item.receivedAt)}</span>
                    <span className="text-line2">•</span>
                    <span>{timeAgo(item.receivedAt, now)}</span>
                    <span className="text-line2">•</span>
                    <span className="mono">{formatBytes(item.bodySize)}</span>
                    <span className="text-line2">•</span>
                    <span className="truncate">{bodyKindLabel(item.bodyKind)}</span>
                    <span className="ml-auto mono text-slate-400">{item.statusCode}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        {hasMore ? (
          <div ref={sentinelRef} className="px-3 py-3 text-center">
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="rounded-md border border-line2/70 bg-panel2/70 px-2.5 py-1 text-[11px] text-muted transition hover:text-slate-200 disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load older requests'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
