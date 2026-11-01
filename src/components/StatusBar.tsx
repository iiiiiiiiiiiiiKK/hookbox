import { Activity, Database, Radio, WifiOff } from 'lucide-react';
import type { LimitsInfo } from '../../shared/types';
import type { ConnectionState } from '../hooks/useRequests';
import { formatBytes } from '../lib/format';

interface StatusBarProps {
  connection: ConnectionState;
  total: number;
  filtered: number;
  storageBytes: number;
  limits: LimitsInfo | null;
  version: string;
}

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  live: 'Live · SSE',
  polling: 'Polling · 4s',
  offline: 'Offline',
};

export function StatusBar({
  connection,
  total,
  filtered,
  storageBytes,
  limits,
  version,
}: StatusBarProps) {
  const connectionColor =
    connection === 'live'
      ? 'text-accent'
      : connection === 'polling'
        ? 'text-amber-300'
        : connection === 'connecting'
          ? 'text-slate-300'
          : 'text-rose-300';

  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-panel/90 px-3 py-1.5 text-[10.5px] text-muted sm:px-4">
      <span
        className={`inline-flex items-center gap-1.5 ${connectionColor}`}
        data-testid="connection-state"
      >
        {connection === 'offline' ? (
          <WifiOff size={11} />
        ) : connection === 'live' ? (
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />
        ) : connection === 'polling' ? (
          <Radio size={11} />
        ) : (
          <Activity size={11} />
        )}
        {CONNECTION_LABEL[connection]}
      </span>

      <span className="inline-flex items-center gap-1">
        <Database size={11} />
        <span className="mono">
          {total}
          {filtered !== total ? ` / ${filtered} shown` : ''} requests
        </span>
      </span>

      <span className="mono hidden sm:inline">
        {formatBytes(storageBytes)} / {formatBytes(limits?.maxStoragePerInboxBytes ?? 0)} stored
      </span>

      <span className="mono ml-auto hidden md:inline">
        body ≤ {formatBytes(limits?.maxBodyBytes ?? 0)} · {limits?.maxRequestsPerInbox ?? 0}{' '}
        req/inbox · {limits?.maxTtlHours ?? 24}h max TTL
      </span>
      <span className="mono hidden lg:inline text-slate-500">v{version}</span>
    </footer>
  );
}
