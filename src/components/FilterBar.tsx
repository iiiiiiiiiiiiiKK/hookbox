import { Search, X } from 'lucide-react';
import type { Filters } from '../hooks/useRequests';
import { hasActiveFilters } from '../hooks/useRequests';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const BODY_KINDS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Any body' },
  { value: 'json', label: 'JSON' },
  { value: 'xml', label: 'XML' },
  { value: 'form', label: 'Form' },
  { value: 'multipart', label: 'Multipart' },
  { value: 'text', label: 'Text' },
  { value: 'binary', label: 'Binary' },
  { value: 'empty', label: 'No body' },
];

const RANGES: Array<{ value: number | null; label: string }> = [
  { value: null, label: 'All time' },
  { value: 5 * 60 * 1000, label: 'Last 5m' },
  { value: 60 * 60 * 1000, label: 'Last 1h' },
  { value: 6 * 60 * 60 * 1000, label: 'Last 6h' },
  { value: 24 * 60 * 60 * 1000, label: 'Last 24h' },
];

interface FilterBarProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
  onRefresh: () => void;
}

export function FilterBar({ filters, onChange, onRefresh }: FilterBarProps) {
  const toggleMethod = (method: string) => {
    const exists = filters.methods.includes(method);
    const methods = exists
      ? filters.methods.filter((entry) => entry !== method)
      : [...filters.methods, method];
    onChange({ ...filters, methods });
  };

  const active = hasActiveFilters(filters);

  return (
    <div className="border-b border-line px-3 py-2">
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            value={filters.keyword}
            onChange={(event) => onChange({ ...filters, keyword: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onRefresh();
            }}
            placeholder="Search path, body or headers…"
            aria-label="Search requests"
            className="mono w-full rounded-md border border-line2/70 bg-panel2/70 py-1 pl-7 pr-2 text-[11px] text-slate-200 outline-none placeholder:text-muted/70 focus:border-accent/50"
            style={{ paddingLeft: '1.6rem' }}
          />
        </div>
        <select
          value={filters.contentType}
          onChange={(event) => onChange({ ...filters, contentType: event.target.value })}
          aria-label="Filter by body type"
          className="shrink-0 rounded-md border border-line2/70 bg-panel2/70 px-1.5 py-1 text-[11px] text-slate-300 outline-none focus:border-accent/50"
        >
          {BODY_KINDS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
        <select
          value={filters.sinceMs === null ? '' : String(filters.sinceMs)}
          onChange={(event) =>
            onChange({
              ...filters,
              sinceMs: event.target.value === '' ? null : Number(event.target.value),
            })
          }
          aria-label="Filter by time range"
          className="shrink-0 rounded-md border border-line2/70 bg-panel2/70 px-1.5 py-1 text-[11px] text-slate-300 outline-none focus:border-accent/50"
        >
          {RANGES.map((entry) => (
            <option
              key={String(entry.value)}
              value={entry.value === null ? '' : String(entry.value)}
            >
              {entry.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-1.5 flex items-center gap-1 overflow-x-auto pb-0.5">
        {METHODS.map((method) => {
          const selected = filters.methods.includes(method);
          return (
            <button
              key={method}
              type="button"
              onClick={() => toggleMethod(method)}
              aria-pressed={selected}
              className={`mono shrink-0 rounded border px-1.5 py-0.5 text-[10px] transition ${
                selected
                  ? 'border-accent/50 bg-accent/15 text-accent'
                  : 'border-line2/60 bg-panel2/50 text-muted hover:text-slate-200'
              }`}
            >
              {method}
            </button>
          );
        })}
        {active ? (
          <button
            type="button"
            onClick={() =>
              onChange({ methods: [], keyword: '', contentType: '', path: '', sinceMs: null })
            }
            className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-muted transition hover:text-rose-300"
          >
            <X size={10} /> clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
