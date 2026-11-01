import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BookOpen,
  ChevronDown,
  Download,
  ExternalLink,
  Link2,
  Menu as MenuIcon,
  Plus,
  Timer,
  Trash2,
} from 'lucide-react';
import type { InboxPublic, LimitsInfo } from '../../shared/types';
import type { SavedInbox } from '../lib/storage';
import { CopyButton } from './CopyButton';
import { Countdown } from './Countdown';

interface HeaderProps {
  inbox: InboxPublic | null;
  savedInboxes: SavedInbox[];
  limits: LimitsInfo | null;
  busy: boolean;
  onSwitchInbox: (id: string) => void;
  onNewInbox: () => void;
  onExtend: (hours: number) => void;
  onDeleteInbox: () => void;
  onClearAll: () => void;
  onExportAll: () => void;
  onOpenTutorials: () => void;
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="relative grid h-7 w-7 place-items-center rounded-lg border border-accent/30 bg-accent/10">
        <span className="mono text-[11px] font-bold text-accent">
          {'{'}•{'}'}
        </span>
      </span>
      {!compact ? (
        <span className="text-[13.5px] font-semibold tracking-tight text-slate-100">
          Hook<span className="text-accent">Box</span>
        </span>
      ) : null}
    </div>
  );
}

export function XLink({ showHandle = true }: { showHandle?: boolean }) {
  return (
    <a
      href="https://x.com/0xkillcoin"
      target="_blank"
      rel="noreferrer noopener"
      aria-label="Author on X: @0xkillcoin"
      title="@0xkillcoin on X"
      className="inline-flex items-center gap-1.5 rounded-md border border-line2/60 bg-panel2/60 px-2 py-1 text-[11px] text-muted transition hover:border-accent/40 hover:text-accent"
    >
      <span className="text-[13px] leading-none">𝕏</span>
      {showHandle ? <span className="mono hidden sm:inline">@0xkillcoin</span> : null}
    </a>
  );
}

export function Header({
  inbox,
  savedInboxes,
  limits,
  busy,
  onSwitchInbox,
  onNewInbox,
  onExtend,
  onDeleteInbox,
  onClearAll,
  onExportAll,
  onOpenTutorials,
}: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <header className="shrink-0 border-b border-line bg-panel/80 backdrop-blur">
      <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
        <Brand />
        <XLink />

        <div className="ml-1 hidden min-w-0 items-center gap-1.5 sm:flex">
          <span className="text-[10px] uppercase tracking-wide text-muted">inbox</span>
          <select
            value={inbox?.id ?? ''}
            onChange={(event) => onSwitchInbox(event.target.value)}
            aria-label="Switch inbox"
            className="mono max-w-[9.5rem] rounded-md border border-line2/60 bg-panel2/70 px-1.5 py-1 text-[11px] text-slate-200 outline-none focus:border-accent/50"
          >
            {savedInboxes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label ? `${entry.label} · ${entry.id.slice(0, 6)}` : entry.id}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {inbox ? <Countdown expiresAt={inbox.expiresAt} /> : null}
          <button
            type="button"
            onClick={onNewInbox}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
          >
            <Plus size={12} /> <span className="hidden xs:inline sm:inline">New</span>
          </button>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((previous) => !previous)}
              aria-label="Inbox actions"
              aria-expanded={menuOpen}
              className="inline-flex items-center gap-1 rounded-md border border-line2/70 bg-panel2/70 px-2 py-1 text-[11px] text-slate-300 transition hover:border-accent/40 hover:text-accent"
            >
              <MenuIcon size={12} />
              <ChevronDown size={11} />
            </button>
            {menuOpen ? (
              <div className="fade-in absolute right-0 top-full z-40 mt-1.5 w-60 overflow-hidden rounded-lg border border-line bg-panel2 shadow-2xl">
                <div className="border-b border-line/70 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted">Extend lifetime</p>
                  <div className="mt-1.5 flex gap-1">
                    {(limits?.allowedTtlHours ?? [1, 6, 24]).map((hours) => (
                      <button
                        key={hours}
                        type="button"
                        onClick={() => {
                          onExtend(hours);
                          setMenuOpen(false);
                        }}
                        className="mono inline-flex flex-1 items-center justify-center gap-1 rounded border border-line2/70 px-1.5 py-1 text-[10.5px] text-slate-300 transition hover:border-accent/50 hover:text-accent"
                      >
                        <Timer size={10} /> +{hours}h
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[10px] leading-snug text-muted">
                    Capped by the server at {limits?.maxTtlHours ?? 24}h total lifetime.
                  </p>
                </div>
                <MenuItem
                  icon={<BookOpen size={13} />}
                  label="Integration examples"
                  onClick={onOpenTutorials}
                  close={setMenuOpen}
                />
                <MenuItem
                  icon={<Download size={13} />}
                  label="Export all requests"
                  onClick={onExportAll}
                  close={setMenuOpen}
                />
                <MenuItem
                  icon={<Trash2 size={13} />}
                  label="Clear all requests"
                  onClick={onClearAll}
                  close={setMenuOpen}
                />
                <MenuItem
                  icon={<ExternalLink size={13} />}
                  label="Delete this inbox"
                  onClick={onDeleteInbox}
                  close={setMenuOpen}
                  danger
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {inbox ? <WebhookBar webhookUrl={inbox.webhookUrl} inboxId={inbox.id} /> : null}
    </header>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  close,
  danger = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  close: (open: boolean) => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        close(false);
        onClick();
      }}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11.5px] transition hover:bg-white/[0.04] ${
        danger ? 'text-rose-300' : 'text-slate-300'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function WebhookBar({ webhookUrl, inboxId }: { webhookUrl: string; inboxId: string }) {
  return (
    <div className="flex items-center gap-1.5 border-t border-line/70 bg-ink/40 px-3 py-1.5 sm:px-4">
      <Link2 size={12} className="shrink-0 text-accent" />
      <code
        data-testid="webhook-url"
        className="mono min-w-0 flex-1 truncate text-[11px] text-slate-300"
        title={webhookUrl}
      >
        {webhookUrl}
      </code>
      <CopyButton value={webhookUrl} label="Copy" size={12} />
      <span className="mono hidden rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted sm:inline">
        {inboxId}
      </span>
    </div>
  );
}
