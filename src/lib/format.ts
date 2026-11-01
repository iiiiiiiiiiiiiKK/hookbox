import type { BodyKind } from '../../shared/types';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.toLocaleDateString()} ${formatTime(timestamp)}`;
}

export function timeAgo(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < 1_000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

export const METHOD_STYLES: Record<string, { text: string; bg: string; border: string }> = {
  GET: { text: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  POST: { text: 'text-sky-300', bg: 'bg-sky-500/10', border: 'border-sky-500/30' },
  PUT: { text: 'text-amber-300', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  PATCH: { text: 'text-violet-300', bg: 'bg-violet-500/10', border: 'border-violet-500/30' },
  DELETE: { text: 'text-rose-300', bg: 'bg-rose-500/10', border: 'border-rose-500/30' },
  HEAD: { text: 'text-slate-300', bg: 'bg-slate-500/10', border: 'border-slate-500/30' },
  OPTIONS: { text: 'text-slate-300', bg: 'bg-slate-500/10', border: 'border-slate-500/30' },
};

export function methodStyle(method: string) {
  return METHOD_STYLES[method.toUpperCase()] ?? METHOD_STYLES.OPTIONS!;
}

export const BODY_KIND_LABEL: Record<BodyKind, string> = {
  empty: 'no body',
  json: 'JSON',
  xml: 'XML',
  form: 'form',
  multipart: 'multipart',
  text: 'text',
  binary: 'binary',
};

export function bodyKindLabel(kind: BodyKind): string {
  return BODY_KIND_LABEL[kind] ?? kind;
}

export function truncatedPath(path: string, max = 48): string {
  if (path.length <= max) return path;
  return `${path.slice(0, max - 1)}…`;
}

export function contentTypeShort(contentType: string | null): string {
  if (!contentType) return '—';
  return contentType.split(';')[0]!.trim();
}
