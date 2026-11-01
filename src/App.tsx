import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Timer } from 'lucide-react';
import type { InboxPublic, MetaResponse, ReplayResult, RequestDetail } from '../shared/types';
import { api, ApiError } from './lib/api';
import { EMPTY_FILTERS, useRequests, type Filters } from './hooks/useRequests';
import {
  dropInbox,
  loadInboxes,
  persistInboxes,
  upsertInbox,
  type SavedInbox,
} from './lib/storage';
import { Header, Brand, XLink } from './components/Header';
import { Landing } from './components/Landing';
import { FilterBar } from './components/FilterBar';
import { RequestList } from './components/RequestList';
import { RequestDetail as RequestDetailPanel } from './components/RequestDetail';
import { ReplayDialog } from './components/ReplayDialog';
import { TutorialsDialog } from './components/TutorialsDialog';
import { StatusBar } from './components/StatusBar';
import { Modal } from './components/Modal';
import { ToastProvider, useToast } from './components/Toasts';

type InboxState = 'idle' | 'loading' | 'ready' | 'expired' | 'missing';

interface ConfirmState {
  title: string;
  body: string;
  confirmLabel: string;
  danger: boolean;
  onConfirm: () => void;
}

function AppInner() {
  const toast = useToast();
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [saved, setSaved] = useState<SavedInbox[]>(() => loadInboxes());
  const [currentId, setCurrentId] = useState<string | null>(() => loadInboxes()[0]?.id ?? '');
  const [inbox, setInbox] = useState<InboxPublic | null>(null);
  const [inboxState, setInboxState] = useState<InboxState>('idle');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const [showTutorials, setShowTutorials] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  const current = useMemo(
    () => saved.find((entry) => entry.id === currentId) ?? null,
    [saved, currentId],
  );
  const token = current?.token ?? null;

  const requests = useRequests({
    inboxId: inboxState === 'ready' ? currentId : null,
    token,
    filters,
    enabled: inboxState === 'ready',
  });

  // Clock for relative timestamps + countdowns.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    api
      .meta()
      .then(setMeta)
      .catch(() => toast.error('Could not reach the HookBox API'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const forgetInbox = useCallback((id: string) => {
    setSaved((previous) => {
      const next = dropInbox(previous, id);
      persistInboxes(next);
      return next;
    });
  }, []);

  const loadInbox = useCallback(
    async (id: string, activeToken: string) => {
      setInboxState('loading');
      try {
        const response = await api.getInbox(id, activeToken);
        setInbox(response.inbox);
        setInboxState(response.inbox.status === 'expired' ? 'expired' : 'ready');
      } catch (error) {
        if (error instanceof ApiError && (error.status === 410 || error.status === 404)) {
          setInbox(null);
          setInboxState(error.code === 'inbox_expired' ? 'expired' : 'missing');
        } else {
          setInboxState('missing');
          toast.error(error instanceof ApiError ? error.message : 'Could not load this inbox');
        }
      }
    },
    [toast],
  );

  useEffect(() => {
    if (!currentId) {
      setInbox(null);
      setInboxState('idle');
      return;
    }
    if (!token) {
      setInbox(null);
      setInboxState('missing');
      return;
    }
    void loadInbox(currentId, token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, token]);

  // Keep counters fresh even while idle.
  useEffect(() => {
    if (inboxState !== 'ready' || !currentId || !token) return;
    const timer = window.setInterval(() => {
      void api
        .getInbox(currentId, token)
        .then((response) => setInbox(response.inbox))
        .catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [inboxState, currentId, token]);

  // Load the selected request detail (masked unless revealed).
  useEffect(() => {
    if (!currentId || !token || !selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    api
      .getRequest(currentId, token, selectedId, reveal)
      .then((response) => {
        if (!cancelled) setDetail(response.request);
      })
      .catch((error) => {
        if (cancelled) return;
        setDetail(null);
        if (error instanceof ApiError && error.status === 404) {
          setSelectedId(null);
        } else {
          toast.error(error instanceof ApiError ? error.message : 'Could not load the request');
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, token, selectedId, reveal]);

  const createInbox = async (ttlHours: number) => {
    setCreating(true);
    try {
      const response = await api.createInbox(ttlHours);
      const entry: SavedInbox = {
        id: response.inbox.id,
        token: response.token,
        createdAt: response.inbox.createdAt,
        expiresAt: response.inbox.expiresAt,
        ttlHours,
        label: response.inbox.label,
      };
      const next = upsertInbox(saved, entry);
      setSaved(next);
      persistInboxes(next);
      setInbox(response.inbox);
      setInboxState('ready');
      setCurrentId(entry.id);
      setSelectedId(null);
      setFilters(EMPTY_FILTERS);
      toast.success('Inbox created — copy the webhook URL below');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not create an inbox');
    } finally {
      setCreating(false);
    }
  };

  const extendInbox = async (hours: number) => {
    if (!currentId || !token) return;
    setBusy(true);
    try {
      const response = await api.extendInbox(currentId, token, hours);
      setInbox(response.inbox);
      setSaved((previous) => {
        const next = previous.map((entry) =>
          entry.id === currentId
            ? { ...entry, expiresAt: response.inbox.expiresAt, ttlHours: hours }
            : entry,
        );
        persistInboxes(next);
        return next;
      });
      toast.success(`Inbox extended by ${Math.round(response.extendedByMs / 60_000)} minutes`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not extend this inbox');
    } finally {
      setBusy(false);
    }
  };

  const deleteInbox = () => {
    if (!currentId || !token) return;
    setConfirm({
      title: 'Delete this inbox?',
      body: 'The inbox, its access token and every stored request are removed from the database immediately. This cannot be undone.',
      confirmLabel: 'Delete inbox',
      danger: true,
      onConfirm: async () => {
        setConfirm(null);
        setBusy(true);
        try {
          await api.deleteInbox(currentId, token);
          forgetInbox(currentId);
          setInbox(null);
          setInboxState('idle');
          setSelectedId(null);
          setCurrentId(saved.find((entry) => entry.id !== currentId)?.id ?? '');
          toast.success('Inbox deleted');
        } catch (error) {
          toast.error(error instanceof ApiError ? error.message : 'Could not delete this inbox');
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const clearAllRequests = () => {
    if (!currentId || !token) return;
    setConfirm({
      title: 'Clear every stored request?',
      body: `All ${requests.total} requests in this inbox will be deleted. The inbox itself keeps working.`,
      confirmLabel: 'Clear requests',
      danger: true,
      onConfirm: async () => {
        setConfirm(null);
        setBusy(true);
        try {
          const response = await api.clearRequests(currentId, token);
          requests.clearLocal();
          setSelectedId(null);
          toast.success(`Cleared ${response.deleted} requests`);
        } catch (error) {
          toast.error(error instanceof ApiError ? error.message : 'Could not clear requests');
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const deleteRequest = async () => {
    if (!currentId || !token || !selectedId) return;
    try {
      await api.deleteRequest(currentId, token, selectedId);
      requests.removeLocal(selectedId);
      setSelectedId(null);
      toast.success('Request deleted');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not delete the request');
    }
  };

  const exportAll = () => {
    if (!currentId || !token) return;
    setConfirm({
      title: 'Export all requests?',
      body: reveal
        ? 'The export contains UNREDACTED headers and bodies — including any credentials your senders transmitted. Store it safely.'
        : 'Sensitive headers and fields stay masked in this export. Enable “Show raw data” first if you need the original values.',
      confirmLabel: 'Download JSON',
      danger: false,
      onConfirm: async () => {
        setConfirm(null);
        try {
          const response = await fetch(api.exportUrl(currentId, reveal), {
            headers: { authorization: `Bearer ${token}` },
          });
          if (!response.ok) throw new Error(`Export failed (${response.status})`);
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `hookbox-export-${currentId}.json`;
          anchor.click();
          URL.revokeObjectURL(url);
          toast.success('Export downloaded');
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Export failed');
        }
      },
    });
  };

  const runReplay = async (targetUrl: string, includeSensitive: boolean): Promise<ReplayResult> => {
    if (!currentId || !token || !selectedId) throw new Error('No request selected');
    const response = await api.replay(currentId, token, selectedId, targetUrl, includeSensitive);
    return response.replay;
  };

  const selectRequest = (id: string) => {
    setSelectedId(id);
    setReveal(false);
  };

  const showLanding = !currentId || inboxState === 'missing' || inboxState === 'idle';

  if (showLanding) {
    return (
      <>
        <Landing
          onCreate={createInbox}
          onResume={(id) => setCurrentId(id)}
          busy={creating}
          savedInboxes={saved}
          limits={meta?.limits ?? null}
        />
        {inboxState === 'missing' && currentId ? (
          <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-2 bg-rose-500/15 px-3 py-1.5 text-[11px] text-rose-200">
            <AlertTriangle size={12} /> That inbox no longer exists on the server — it expired or
            was deleted.
          </div>
        ) : null}
      </>
    );
  }

  if (inboxState === 'loading' && !inbox) {
    return (
      <div className="grid h-dvh place-items-center">
        <div className="flex flex-col items-center gap-2 text-xs text-muted">
          <Brand />
          Loading inbox…
        </div>
      </div>
    );
  }

  if (inboxState === 'expired') {
    return (
      <div className="flex h-dvh flex-col">
        <header className="flex items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
          <Brand />
          <XLink />
        </header>
        <main className="grid flex-1 place-items-center px-4">
          <div className="max-w-md text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-300">
              <Timer size={20} />
            </div>
            <h1 className="mt-3 text-lg font-semibold text-slate-100">This inbox has expired</h1>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              HookBox deletes expired inboxes and their requests from the database. Create a fresh
              inbox to keep debugging — it takes one click.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (currentId) forgetInbox(currentId);
                  setCurrentId('');
                  setInbox(null);
                  setInboxState('idle');
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[12px] font-semibold text-ink"
              >
                <Plus size={13} /> Create a new inbox
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Header
        inbox={inbox}
        savedInboxes={saved}
        limits={meta?.limits ?? null}
        busy={busy}
        onSwitchInbox={(id) => {
          setCurrentId(id);
          setSelectedId(null);
          setFilters(EMPTY_FILTERS);
        }}
        onNewInbox={() => {
          setCurrentId('');
          setInbox(null);
          setInboxState('idle');
        }}
        onExtend={(hours) => void extendInbox(hours)}
        onDeleteInbox={deleteInbox}
        onClearAll={clearAllRequests}
        onExportAll={exportAll}
        onOpenTutorials={() => setShowTutorials(true)}
      />

      <main className="flex min-h-0 flex-1">
        {(!isMobile || !selectedId) && (
          <aside
            className={`flex w-full shrink-0 flex-col border-line md:w-[350px] md:border-r lg:w-[400px] ${isMobile && selectedId ? 'hidden' : ''}`}
          >
            <FilterBar
              filters={filters}
              onChange={setFilters}
              onRefresh={() => void requests.refresh()}
            />
            <div className="min-h-0 flex-1">
              <RequestList
                items={requests.items}
                selectedId={selectedId}
                onSelect={selectRequest}
                loading={requests.loading}
                loadingMore={requests.loadingMore}
                hasMore={requests.hasMore}
                onLoadMore={() => void requests.loadMore()}
                pendingCount={requests.pendingCount}
                onRefresh={() => void requests.refresh()}
                onShowPending={() => requests.clearPending()}
                webhookUrl={inbox?.webhookUrl ?? null}
                now={now}
              />
            </div>
            {requests.error ? (
              <p className="border-t border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[10.5px] text-rose-200">
                {requests.error}
              </p>
            ) : null}
          </aside>
        )}

        {(!isMobile || selectedId) && (
          <section className={`min-w-0 flex-1 ${isMobile ? 'flex' : 'hidden md:flex'} flex-col`}>
            {isMobile && !selectedId ? null : (
              <RequestDetailPanel
                request={detail}
                loading={detailLoading}
                reveal={reveal}
                onToggleReveal={() => setReveal((previous) => !previous)}
                onDelete={() => void deleteRequest()}
                onReplay={() => setShowReplay(true)}
                onClose={isMobile ? () => setSelectedId(null) : undefined}
                isMobile={isMobile}
              />
            )}
          </section>
        )}
      </main>

      <StatusBar
        connection={requests.connection}
        total={requests.total}
        filtered={requests.filtered}
        storageBytes={inbox?.storageBytes ?? 0}
        limits={meta?.limits ?? null}
        version={meta?.version ?? '1.0.0'}
      />

      <ReplayDialog
        open={showReplay}
        request={detail}
        onClose={() => setShowReplay(false)}
        onRun={runReplay}
      />
      <TutorialsDialog
        open={showTutorials}
        onClose={() => setShowTutorials(false)}
        webhookUrl={inbox?.webhookUrl ?? null}
      />
      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.title ?? ''}
        width="max-w-md"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirm(null)}
              className="rounded-md border border-line2/70 px-3 py-1.5 text-[11.5px] text-slate-300 transition hover:text-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => confirm?.onConfirm()}
              className={`rounded-md px-3 py-1.5 text-[11.5px] font-semibold transition ${
                confirm?.danger
                  ? 'bg-rose-500 text-white hover:bg-rose-400'
                  : 'bg-accent text-ink hover:bg-accent/90'
              }`}
            >
              {confirm?.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        }
      >
        <p className="text-[12px] leading-relaxed text-slate-300">{confirm?.body}</p>
      </Modal>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
