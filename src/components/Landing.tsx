import { useState } from 'react';
import {
  ArrowRight,
  Boxes,
  EyeOff,
  GitBranch,
  Radio,
  Server,
  ShieldCheck,
  Terminal,
  Timer,
  Zap,
} from 'lucide-react';
import type { LimitsInfo } from '../../shared/types';
import type { SavedInbox } from '../lib/storage';
import { Brand, XLink } from './Header';
import { Countdown } from './Countdown';
import { formatDateTime } from '../lib/format';

interface LandingProps {
  onCreate: (ttlHours: number) => void;
  onResume: (id: string) => void;
  busy: boolean;
  savedInboxes: SavedInbox[];
  limits: LimitsInfo | null;
}

const FEATURES = [
  {
    icon: <Server size={15} />,
    title: 'A real HTTP endpoint',
    body: 'Every request is stored server-side in Cloudflare D1 — not faked in the browser. GET, POST, PUT, PATCH and DELETE all land here.',
  },
  {
    icon: <Radio size={15} />,
    title: 'Live over SSE',
    body: 'New hits stream in over Server-Sent Events, with an automatic polling fallback when a proxy blocks long-lived connections.',
  },
  {
    icon: <EyeOff size={15} />,
    title: 'Masked by default',
    body: 'Authorization headers, cookies and token-ish JSON fields are redacted before they reach the screen. Reveal raw data on demand.',
  },
  {
    icon: <ShieldCheck size={15} />,
    title: 'Replay without SSRF',
    body: 'Replays only reach public HTTP(S) endpoints: DNS answers, private ranges, redirects and cloud metadata addresses are all blocked.',
  },
];

const STEPS = [
  {
    step: '01',
    title: 'Create an inbox',
    body: 'Pick a TTL — 1h, 6h or 24h. You get a unique webhook URL plus a private access token.',
  },
  {
    step: '02',
    title: 'Point a service at it',
    body: 'GitHub, Stripe, Telegram or a curl one-liner. Any method, any content type.',
  },
  {
    step: '03',
    title: 'Inspect and replay',
    body: 'Read headers, query, body and raw bytes, search across requests, then replay safely.',
  },
];

export function Landing({ onCreate, onResume, busy, savedInboxes, limits }: LandingProps) {
  const [ttl, setTtl] = useState(1);
  const ttlOptions = limits?.allowedTtlHours ?? [1, 6, 24];
  const activeInboxes = savedInboxes.filter((entry) => entry.expiresAt > Date.now());

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="grid-bg min-h-full">
        <header className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-4">
          <Brand />
          <XLink />
          <a
            href="https://github.com/iiiiiiiiiiiiiKK/hookbox"
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-line2/60 bg-panel2/60 px-2 py-1 text-[11px] text-muted transition hover:border-accent/40 hover:text-accent"
          >
            <GitBranch size={12} /> <span className="hidden sm:inline">Source</span>
          </a>
        </header>

        <main className="mx-auto max-w-5xl px-4 pb-16">
          <section className="pt-6 sm:pt-12">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line2/70 bg-panel2/60 px-2.5 py-1 text-[10.5px] uppercase tracking-wider text-muted">
              <Zap size={11} className="text-accent" /> webhook debugging inbox
            </span>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-50 sm:text-5xl">
              Catch it. Inspect it. <span className="text-accent">Debug it.</span>
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">
              接收每一次请求，看清每一个细节。HookBox gives you a disposable webhook URL, records
              every request byte, and lets you replay it safely — no account, no credit card, no
              local tunnel.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="inline-flex overflow-hidden rounded-lg border border-line2/70 bg-panel2/70 p-1">
                {ttlOptions.map((hours) => (
                  <button
                    key={hours}
                    type="button"
                    onClick={() => setTtl(hours)}
                    aria-pressed={ttl === hours}
                    className={`mono rounded-md px-3 py-1.5 text-[11.5px] transition ${
                      ttl === hours ? 'bg-accent/15 text-accent' : 'text-muted hover:text-slate-200'
                    }`}
                  >
                    {hours}h TTL
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onCreate(ttl)}
                disabled={busy}
                data-testid="create-inbox"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-[13px] font-semibold text-ink shadow-lg shadow-accent/20 transition hover:bg-accent/90 disabled:opacity-60"
              >
                {busy ? 'Creating…' : 'Create inbox'}
                <ArrowRight size={15} />
              </button>
              <span className="text-[11px] text-muted">
                Free · no sign-up · data self-destructs in {ttl}h
              </span>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1">
                <Timer size={11} /> hard TTL + cron cleanup
              </span>
              <span className="inline-flex items-center gap-1">
                <Boxes size={11} /> {limits?.maxRequestsPerInbox ?? 500} requests / inbox
              </span>
              <span className="inline-flex items-center gap-1">
                <Terminal size={11} /> body ≤ {Math.round((limits?.maxBodyBytes ?? 262144) / 1024)}{' '}
                KiB
              </span>
            </div>
          </section>

          {activeInboxes.length > 0 ? (
            <section className="mt-10">
              <h2 className="text-[11px] uppercase tracking-wider text-muted">Resume an inbox</h2>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {activeInboxes.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => onResume(entry.id)}
                      className="flex w-full items-center gap-2 rounded-lg border border-line/70 bg-panel/70 px-3 py-2 text-left transition hover:border-accent/40"
                    >
                      <span className="mono min-w-0 flex-1 truncate text-[11.5px] text-slate-200">
                        {entry.label ? `${entry.label} · ` : ''}
                        {entry.id}
                      </span>
                      <Countdown expiresAt={entry.expiresAt} showLabel={false} />
                      <ArrowRight size={13} className="shrink-0 text-muted" />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[10.5px] text-muted">
                Access tokens are stored only in this browser. Created{' '}
                {formatDateTime(activeInboxes[0]!.createdAt)}.
              </p>
            </section>
          ) : null}

          <section className="mt-12 grid gap-3 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-line/70 bg-panel/60 p-4 transition hover:border-line2"
              >
                <div className="flex items-center gap-2 text-accent">
                  {feature.icon}
                  <h3 className="text-[12.5px] font-semibold text-slate-100">{feature.title}</h3>
                </div>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">{feature.body}</p>
              </div>
            ))}
          </section>

          <section className="mt-12">
            <h2 className="text-[11px] uppercase tracking-wider text-muted">How it works</h2>
            <ol className="mt-2 grid gap-3 sm:grid-cols-3">
              {STEPS.map((step) => (
                <li key={step.step} className="rounded-xl border border-line/70 bg-panel/60 p-4">
                  <span className="mono text-[10.5px] text-accent">{step.step}</span>
                  <h3 className="mt-1 text-[12.5px] font-semibold text-slate-100">{step.title}</h3>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{step.body}</p>
                </li>
              ))}
            </ol>
          </section>

          <footer className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line/70 pt-4 text-[10.5px] text-muted">
            <span>MIT licensed · built with React, Hono-free Workers and D1</span>
            <a
              className="inline-flex items-center gap-1 transition hover:text-accent"
              href="https://github.com/iiiiiiiiiiiiiKK/hookbox"
              target="_blank"
              rel="noreferrer noopener"
            >
              <GitBranch size={11} /> iiii...KK/hookbox
            </a>
            <a
              className="inline-flex items-center gap-1 transition hover:text-accent"
              href="https://x.com/0xkillcoin"
              target="_blank"
              rel="noreferrer noopener"
            >
              𝕏 @0xkillcoin
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}
