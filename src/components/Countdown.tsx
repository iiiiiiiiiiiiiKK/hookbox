import { useEffect, useState } from 'react';
import { formatDuration } from '../lib/format';

interface CountdownProps {
  expiresAt: number;
  className?: string;
  showLabel?: boolean;
}

export function Countdown({ expiresAt, className = '', showLabel = true }: CountdownProps) {
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAt - Date.now()));

  useEffect(() => {
    setRemaining(Math.max(0, expiresAt - Date.now()));
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, expiresAt - Date.now()));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  const expired = remaining <= 0;
  const urgent = remaining > 0 && remaining < 5 * 60 * 1000;

  return (
    <span
      className={`mono inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] tabular-nums ${
        expired
          ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
          : urgent
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
            : 'border-line2/70 bg-panel2/70 text-slate-300'
      } ${className}`}
      title={
        expired ? 'This inbox has expired' : `Expires at ${new Date(expiresAt).toLocaleString()}`
      }
    >
      {showLabel ? <span className="text-muted">{expired ? 'expired' : 'TTL'}</span> : null}
      <span>{expired ? '00:00:00' : formatDuration(remaining)}</span>
    </span>
  );
}
