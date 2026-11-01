import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyButtonProps {
  value: string;
  label?: string;
  title?: string;
  className?: string;
  size?: number;
  onCopied?: () => void;
}

async function writeToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to the textarea fallback */
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  value,
  label,
  title = 'Copy',
  className = '',
  size = 14,
  onCopied,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    const ok = await writeToClipboard(value);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      onCopied?.();
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      title={title}
      aria-label={title}
      className={`inline-flex items-center gap-1.5 rounded-md border border-line2/70 bg-panel2/80 px-2 py-1 text-[11px] font-medium text-muted transition hover:border-accent/40 hover:text-accent ${className}`}
    >
      {copied ? <Check size={size} className="text-accent" /> : <Copy size={size} />}
      {label ? <span>{copied ? 'Copied' : label}</span> : null}
    </button>
  );
}
