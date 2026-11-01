import { useState } from 'react';
import { AlertTriangle, Play, ShieldAlert } from 'lucide-react';
import type { ReplayResult, RequestDetail } from '../../shared/types';
import { ApiError } from '../lib/api';
import { formatBytes, methodStyle } from '../lib/format';
import { Modal } from './Modal';

interface ReplayDialogProps {
  open: boolean;
  request: RequestDetail | null;
  onClose: () => void;
  onRun: (targetUrl: string, includeSensitive: boolean) => Promise<ReplayResult>;
}

export function ReplayDialog({ open, request, onClose, onRun }: ReplayDialogProps) {
  const [target, setTarget] = useState('');
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setResult(null);
    setError(null);
  };

  const run = async () => {
    if (!request) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const replay = await onRun(target.trim(), includeSensitive);
      setResult(replay);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Replay failed');
    } finally {
      setRunning(false);
    }
  };

  const style = request ? methodStyle(request.method) : null;

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Replay this request"
      description="HookBox re-sends the stored request to a public endpoint you choose."
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10.5px] text-muted">
            Public http/https only · ports 80/443 · {(10_000 / 1000).toFixed(0)}s timeout · 10
            replays/min
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                reset();
                onClose();
              }}
              className="rounded-md border border-line2/70 px-3 py-1.5 text-[11.5px] text-slate-300 transition hover:text-slate-100"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => void run()}
              disabled={running || target.trim().length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[11.5px] font-semibold text-ink transition hover:bg-accent/90 disabled:opacity-50"
            >
              <Play size={12} /> {running ? 'Sending…' : 'Send replay'}
            </button>
          </div>
        </div>
      }
    >
      {request ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-100">
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle size={12} /> This performs a real HTTP request
            </p>
            <p className="mt-1 text-amber-200/90">
              If the target belongs to a production service, the replay can create real records,
              charges or notifications. Point it at a staging endpoint unless you mean it.
            </p>
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-300" htmlFor="replay-target">
              Target URL
            </label>
            <input
              id="replay-target"
              type="url"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="https://api.example.com/webhooks/test"
              className="mono mt-1 w-full rounded-md border border-line2/70 bg-panel2/70 px-2.5 py-2 text-[11.5px] text-slate-200 outline-none placeholder:text-muted/70 focus:border-accent/60"
            />
            <p className="mt-1 text-[10.5px] text-muted">
              Localhost, private IPs, internal hostnames, cloud metadata endpoints and non-80/443
              ports are rejected. Redirect hops are re-validated.
            </p>
          </div>

          <div className="rounded-lg border border-line/70 bg-panel2/40 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted">Preview</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span
                className={`mono rounded border px-1.5 py-0.5 text-[10px] font-semibold ${style?.border} ${style?.bg} ${style?.text}`}
              >
                {request.method}
              </span>
              <span className="mono truncate text-[11px] text-slate-300">{request.path}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[10.5px] text-muted sm:grid-cols-4">
              <span>{request.headerPairCount} headers</span>
              <span>{request.queryPairCount} query params</span>
              <span>{formatBytes(request.bodySize)} body</span>
              <span>{request.bodyKind} body</span>
            </div>
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-line/70 bg-panel2/40 p-3 text-[11px] text-slate-300">
            <input
              type="checkbox"
              checked={includeSensitive}
              onChange={(event) => setIncludeSensitive(event.target.checked)}
              className="mt-0.5 accent-emerald-400"
            />
            <span>
              Also forward sensitive headers (<span className="mono">authorization</span>,{' '}
              <span className="mono">cookie</span>, signature headers…).
              <span className="mt-0.5 block text-[10.5px] text-muted">
                Off by default so a replay never leaks your sender&apos;s credentials to a third
                party.
              </span>
            </span>
          </label>

          {error ? (
            <p className="flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
              <ShieldAlert size={12} className="mt-0.5 shrink-0" /> {error}
            </p>
          ) : null}

          {result ? (
            <div className="rounded-lg border border-line/70 bg-ink/50 p-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span
                  className={`mono rounded px-1.5 py-0.5 font-semibold ${
                    result.status < 300
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : result.status < 400
                        ? 'bg-sky-500/15 text-sky-300'
                        : 'bg-rose-500/15 text-rose-300'
                  }`}
                >
                  {result.status} {result.statusText}
                </span>
                <span className="text-muted">{result.durationMs} ms</span>
                <span className="text-muted">{result.hops} redirect(s)</span>
                <span className="mono truncate text-muted">{result.finalUrl}</span>
              </div>
              <pre className="mono scroll-thin mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-line/60 bg-panel2/50 p-2 text-[10.5px] leading-relaxed text-slate-300">
                {result.bodyPreview || '(empty response body)'}
              </pre>
              {result.bodyPreviewTruncated ? (
                <p className="mt-1 text-[10px] text-muted">
                  Preview truncated · {formatBytes(result.bodyBytes)} total
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
