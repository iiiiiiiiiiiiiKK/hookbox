import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';

interface JsonTreeProps {
  value: unknown;
  name?: string;
  depth?: number;
  defaultExpandedDepth?: number;
}

function isPrimitive(value: unknown): boolean {
  return value === null || typeof value !== 'object';
}

function primitiveNode(value: unknown) {
  if (value === null) return <span className="text-slate-500">null</span>;
  if (typeof value === 'string') {
    return <span className="break-all text-emerald-300">&quot;{value}&quot;</span>;
  }
  if (typeof value === 'number') return <span className="text-amber-300">{String(value)}</span>;
  if (typeof value === 'boolean') return <span className="text-violet-300">{String(value)}</span>;
  return <span className="text-slate-300">{String(value)}</span>;
}

function NodeRow({
  label,
  value,
  depth,
  defaultExpandedDepth,
}: {
  label: string | null;
  value: unknown;
  depth: number;
  defaultExpandedDepth: number;
}) {
  const collapsible = !isPrimitive(value);
  const [expanded, setExpanded] = useState(depth < defaultExpandedDepth);
  const [copied, setCopied] = useState(false);

  const entries = collapsible
    ? Array.isArray(value)
      ? value.map((item, index) => [String(index), item] as [string, unknown])
      : Object.entries(value as Record<string, unknown>)
    : [];

  const copyNode = async () => {
    try {
      await navigator.clipboard.writeText(
        typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard denied */
    }
  };

  return (
    <div className="text-xs leading-relaxed">
      <div className="group flex items-start gap-1 rounded px-1 hover:bg-white/[0.03]">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setExpanded((previous) => !previous)}
            className="mt-0.5 shrink-0 text-muted transition hover:text-accent"
            aria-label={expanded ? 'Collapse node' : 'Expand node'}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="mt-0.5 w-3 shrink-0" />
        )}
        <div className="min-w-0 flex-1 break-words">
          {label !== null ? (
            <>
              <span className="text-sky-300">{label}</span>
              <span className="text-slate-500">: </span>
            </>
          ) : null}
          {collapsible ? (
            <span className="text-slate-500">
              {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
            </span>
          ) : (
            primitiveNode(value)
          )}
        </div>
        <button
          type="button"
          onClick={() => void copyNode()}
          className="mt-0.5 shrink-0 text-muted/0 transition group-hover:text-muted hover:text-accent"
          aria-label="Copy value"
          title="Copy value"
        >
          {copied ? <Check size={11} className="text-accent" /> : <Copy size={11} />}
        </button>
      </div>
      {collapsible && expanded ? (
        <div className="ml-4 border-l border-line/70 pl-2">
          {entries.length === 0 ? (
            <div className="px-1 text-[11px] text-muted">empty</div>
          ) : (
            entries.map(([key, child]) => (
              <NodeRow
                key={key}
                label={key}
                value={child}
                depth={depth + 1}
                defaultExpandedDepth={defaultExpandedDepth}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export function JsonTree({ value, defaultExpandedDepth = 3 }: JsonTreeProps) {
  return (
    <div className="mono scroll-thin overflow-auto rounded-md border border-line/70 bg-ink/60 p-2">
      <NodeRow label={null} value={value} depth={0} defaultExpandedDepth={defaultExpandedDepth} />
    </div>
  );
}

export function JsonView({ text }: { text: string }) {
  let parsed: unknown = null;
  let ok = false;
  try {
    parsed = JSON.parse(text);
    ok = true;
  } catch {
    ok = false;
  }
  if (!ok) return <CodeBlock text={text} />;
  return <JsonTree value={parsed} />;
}

export function CodeBlock({ text, maxHeight = '60vh' }: { text: string; maxHeight?: string }) {
  return (
    <pre
      className="mono scroll-thin overflow-auto whitespace-pre-wrap break-words rounded-md border border-line/70 bg-ink/60 p-3 text-[11.5px] leading-relaxed text-slate-200"
      style={{ maxHeight }}
    >
      {text}
    </pre>
  );
}
