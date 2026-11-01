import { useState } from 'react';
import { Download, ExternalLink, Eye, EyeOff, Send, Trash2, X } from 'lucide-react';
import type { RequestDetail as RequestDetailType } from '../../shared/types';
import {
  bodyKindLabel,
  contentTypeShort,
  formatBytes,
  formatDateTime,
  formatTime,
  methodStyle,
} from '../lib/format';
import { CopyButton } from './CopyButton';
import { CodeBlock, JsonView } from './JsonTree';

type Tab = 'overview' | 'headers' | 'query' | 'body' | 'raw';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'headers', label: 'Headers' },
  { id: 'query', label: 'Query' },
  { id: 'body', label: 'Body' },
  { id: 'raw', label: 'Raw' },
];

function rawHttp(request: RequestDetailType): string {
  const query = request.query.length
    ? `?${request.query.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`
    : '';
  const headers = request.headers.map(([key, value]) => `${key}: ${value}`).join('\r\n');
  const body =
    request.body.text ?? (request.body.base64 ? '[binary body — reveal to export raw]' : '');
  return `${request.method} ${request.path}${query} HTTP/1.1\r\n${headers}\r\n\r\n${body}`;
}

function PairTable({ pairs, revealed }: { pairs: Array<[string, string]>; revealed: boolean }) {
  if (pairs.length === 0) {
    return <p className="px-1 py-6 text-center text-xs text-muted">Nothing here.</p>;
  }
  return (
    <div className="overflow-hidden rounded-md border border-line/70">
      <table className="w-full table-fixed border-collapse text-left text-[11.5px]">
        <thead className="bg-panel2/80 text-[10px] uppercase tracking-wide text-muted">
          <tr>
            <th className="w-2/5 border-b border-line/70 px-3 py-2 font-medium">Key</th>
            <th className="border-b border-line/70 px-3 py-2 font-medium">Value</th>
            <th className="w-10 border-b border-line/70 px-1 py-2" />
          </tr>
        </thead>
        <tbody className="mono">
          {pairs.map(([key, value], index) => {
            const redacted = value === '••••••';
            return (
              <tr key={`${key}-${index}`} className="align-top odd:bg-white/[0.015]">
                <td className="break-all border-b border-line/40 px-3 py-1.5 text-sky-300">
                  {key}
                </td>
                <td className="break-all border-b border-line/40 px-3 py-1.5 text-slate-200">
                  {redacted ? (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10.5px] text-amber-200">
                      redacted
                    </span>
                  ) : (
                    value
                  )}
                </td>
                <td className="border-b border-line/40 px-1 py-1">
                  <CopyButton
                    value={value}
                    title={`Copy ${key}`}
                    size={12}
                    className="!border-0 !bg-transparent !px-1"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!revealed ? (
        <p className="border-t border-line/60 bg-panel2/40 px-3 py-2 text-[10.5px] text-muted">
          Sensitive headers are masked by default. Toggle “raw data” to inspect the original values.
        </p>
      ) : null}
    </div>
  );
}

function BodyView({ request }: { request: RequestDetailType }) {
  const { body } = request;

  if (body.kind === 'empty') {
    return (
      <p className="px-1 py-6 text-center text-xs text-muted">This request carried no body.</p>
    );
  }

  if (body.kind === 'binary') {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
          <span className="rounded bg-white/5 px-2 py-0.5">{formatBytes(body.size)}</span>
          <span className="rounded bg-white/5 px-2 py-0.5">
            {contentTypeShort(request.contentType)}
          </span>
          {body.redacted ? (
            <span className="rounded bg-amber-500/10 px-2 py-0.5 text-amber-200">
              binary payload hidden — reveal raw data to inspect
            </span>
          ) : null}
        </div>
        {body.base64 ? (
          <CodeBlock text={body.base64} maxHeight="40vh" />
        ) : (
          <p className="text-xs text-muted">
            HookBox stores binary payloads as base64 and never tries to decode them as UTF-8.
          </p>
        )}
      </div>
    );
  }

  if (body.kind === 'multipart' && body.parts && body.parts.length > 0) {
    return (
      <div className="space-y-3">
        <div className="overflow-hidden rounded-md border border-line/70">
          <table className="w-full border-collapse text-left text-[11.5px]">
            <thead className="bg-panel2/80 text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="border-b border-line/70 px-3 py-2 font-medium">Field</th>
                <th className="border-b border-line/70 px-3 py-2 font-medium">Type</th>
                <th className="border-b border-line/70 px-3 py-2 font-medium">Size</th>
                <th className="border-b border-line/70 px-3 py-2 font-medium">Preview</th>
              </tr>
            </thead>
            <tbody className="mono">
              {body.parts.map((part, index) => (
                <tr key={`${part.name}-${index}`} className="align-top odd:bg-white/[0.015]">
                  <td className="break-all border-b border-line/40 px-3 py-1.5 text-sky-300">
                    {part.name}
                    {part.filename ? (
                      <span className="ml-1 text-[10.5px] text-muted">({part.filename})</span>
                    ) : null}
                  </td>
                  <td className="border-b border-line/40 px-3 py-1.5 text-muted">
                    {part.contentType ?? 'text'}
                  </td>
                  <td className="border-b border-line/40 px-3 py-1.5 text-slate-300">
                    {formatBytes(part.size)}
                  </td>
                  <td className="break-all border-b border-line/40 px-3 py-1.5 text-slate-200">
                    {part.preview}
                    {part.truncated ? '…' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="rounded-md border border-line/70 bg-ink/40">
          <summary className="cursor-pointer px-3 py-2 text-[11px] text-muted">
            Raw multipart payload
          </summary>
          <div className="p-3 pt-0">
            <CodeBlock text={body.text ?? ''} maxHeight="40vh" />
          </div>
        </details>
      </div>
    );
  }

  if (body.kind === 'json') {
    return (
      <div className="space-y-2">
        {body.redacted ? (
          <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10.5px] text-amber-200">
            Values that look like credentials are masked. Toggle “raw data” for the original
            payload.
          </p>
        ) : null}
        <JsonView text={body.text ?? ''} />
      </div>
    );
  }

  if (body.kind === 'form') {
    const entries = [...new URLSearchParams(body.text ?? '').entries()];
    return (
      <div className="space-y-2">
        <PairTable
          pairs={entries.map(([key, value]) => [key, value] as [string, string])}
          revealed={!body.redacted}
        />
        <details className="rounded-md border border-line/70 bg-ink/40">
          <summary className="cursor-pointer px-3 py-2 text-[11px] text-muted">
            Raw form payload
          </summary>
          <div className="p-3 pt-0">
            <CodeBlock text={body.text ?? ''} maxHeight="40vh" />
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {body.redacted ? (
        <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10.5px] text-amber-200">
          Sensitive values are masked. Toggle “raw data” for the original payload.
        </p>
      ) : null}
      <CodeBlock text={body.text ?? ''} />
    </div>
  );
}

interface RequestDetailProps {
  request: RequestDetailType | null;
  loading: boolean;
  reveal: boolean;
  onToggleReveal: () => void;
  onDelete: () => void;
  onReplay: () => void;
  onClose?: () => void;
  isMobile: boolean;
}

export function RequestDetail({
  request,
  loading,
  reveal,
  onToggleReveal,
  onDelete,
  onReplay,
  onClose,
}: RequestDetailProps) {
  const [tab, setTab] = useState<Tab>('overview');

  const download = () => {
    if (!request) return;
    const blob = new Blob([JSON.stringify({ request }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `hookbox-${request.method}-${request.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!request && loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted">
        Loading request…
      </div>
    );
  }

  if (!request) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-xl border border-line bg-panel2 text-muted">
          <Send size={18} />
        </div>
        <p className="text-sm text-slate-300">Select a request to inspect it</p>
        <p className="max-w-xs text-xs text-muted">
          Every hit on your webhook URL lands here: method, headers, query, body and raw bytes.
        </p>
      </div>
    );
  }

  const style = methodStyle(request.method);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line px-3 py-3 sm:px-5">
        <div className="flex items-start gap-2">
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="-ml-1 mt-0.5 rounded-md p-1.5 text-muted transition hover:bg-panel3 hover:text-slate-200"
              aria-label="Back to request list"
            >
              <X size={16} />
            </button>
          ) : null}
          <span
            className={`mono shrink-0 rounded border px-2 py-0.5 text-[11px] font-semibold ${style.border} ${style.bg} ${style.text}`}
          >
            {request.method}
          </span>
          <div className="min-w-0 flex-1">
            <p className="mono break-all text-[12.5px] leading-snug text-slate-100">
              {request.path}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted">
              <span className="mono">{formatTime(request.receivedAt)}</span>
              <span className="text-line2">•</span>
              <span>{formatBytes(request.bodySize)}</span>
              <span className="text-line2">•</span>
              <span>{bodyKindLabel(request.bodyKind)}</span>
              {request.contentType ? (
                <>
                  <span className="text-line2">•</span>
                  <span className="mono">{contentTypeShort(request.contentType)}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onReplay}
            className="inline-flex items-center gap-1.5 rounded-md border border-line2/70 bg-panel2/80 px-2 py-1 text-[11px] text-slate-200 transition hover:border-accent/40 hover:text-accent"
          >
            <Send size={12} /> Replay
          </button>
          <button
            type="button"
            onClick={download}
            className="inline-flex items-center gap-1.5 rounded-md border border-line2/70 bg-panel2/80 px-2 py-1 text-[11px] text-slate-200 transition hover:border-accent/40 hover:text-accent"
          >
            <Download size={12} /> Export JSON
          </button>
          <button
            type="button"
            onClick={onToggleReveal}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition ${
              reveal
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                : 'border-line2/70 bg-panel2/80 text-slate-200 hover:border-accent/40 hover:text-accent'
            }`}
            title="Sensitive headers and fields are masked unless you opt in"
          >
            {reveal ? <EyeOff size={12} /> : <Eye size={12} />}
            {reveal ? 'Hide raw data' : 'Show raw data'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded-md border border-line2/70 bg-panel2/80 px-2 py-1 text-[11px] text-slate-300 transition hover:border-rose-500/50 hover:text-rose-300"
          >
            <Trash2 size={12} /> Delete
          </button>
          <CopyButton value={rawHttp(request)} label="Copy raw" size={12} className="ml-auto" />
        </div>
      </div>

      <div className="scroll-thin flex gap-1 overflow-x-auto border-b border-line px-2 sm:px-4">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`relative shrink-0 px-2.5 py-2 text-[11.5px] transition ${
              tab === entry.id ? 'text-accent' : 'text-muted hover:text-slate-200'
            }`}
          >
            {entry.label}
            {tab === entry.id ? (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />
            ) : null}
          </button>
        ))}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5">
        {tab === 'overview' ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[11.5px] sm:grid-cols-2">
            {[
              ['Method', request.method],
              ['Path', request.path],
              ['Received', formatDateTime(request.receivedAt)],
              ['Content-Type', request.contentType ?? '—'],
              ['Body size', formatBytes(request.bodySize)],
              ['Body type', bodyKindLabel(request.bodyKind)],
              ['Source IP (hashed)', request.sourceIp ?? 'not provided'],
              ['User-Agent', request.userAgent ?? '—'],
              ['Header count', String(request.headerPairCount)],
              ['Query params', String(request.queryPairCount)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex flex-col gap-0.5 rounded-md border border-line/60 bg-panel2/40 px-2.5 py-1.5"
              >
                <dt className="text-[10px] uppercase tracking-wide text-muted">{label}</dt>
                <dd className="mono break-all text-slate-200">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {tab === 'headers' ? <PairTable pairs={request.headers} revealed={reveal} /> : null}
        {tab === 'query' ? <PairTable pairs={request.query} revealed={reveal} /> : null}
        {tab === 'body' ? <BodyView request={request} /> : null}
        {tab === 'raw' ? (
          <div className="space-y-2">
            {request.body.redacted || !reveal ? (
              <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10.5px] text-amber-200">
                This raw view follows your masking choice. Enable “Show raw data” for unredacted
                bytes.
              </p>
            ) : null}
            <CodeBlock text={rawHttp(request)} />
          </div>
        ) : null}
      </div>

      {request.revealed ? (
        <p className="flex items-center gap-1.5 border-t border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-[10.5px] text-amber-200">
          <ExternalLink size={11} /> Raw data is visible in this view. It never leaves your browser
          session except when you copy or export it.
        </p>
      ) : null}
    </div>
  );
}
