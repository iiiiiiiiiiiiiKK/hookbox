import { useState, type ReactNode } from 'react';
import { Bell, CreditCard, GitBranch, Send, Terminal } from 'lucide-react';
import { Modal } from './Modal';
import { CopyButton } from './CopyButton';

interface TutorialsDialogProps {
  open: boolean;
  onClose: () => void;
  webhookUrl: string | null;
}

type TabId = 'curl' | 'github' | 'stripe' | 'telegram';

const TABS: Array<{ id: TabId; label: string; icon: ReactNode }> = [
  { id: 'curl', label: 'cURL / HTTP', icon: <Terminal size={12} /> },
  { id: 'github', label: 'GitHub', icon: <GitBranch size={12} /> },
  { id: 'stripe', label: 'Stripe', icon: <CreditCard size={12} /> },
  { id: 'telegram', label: 'Telegram', icon: <Send size={12} /> },
];

export function TutorialsDialog({ open, onClose, webhookUrl }: TutorialsDialogProps) {
  const [tab, setTab] = useState<TabId>('curl');
  const url = webhookUrl ?? 'https://hookbox.example.com/hook/<your-inbox-id>';

  const curl = `# JSON POST
curl -X POST '${url}?source=quickstart' \\
  -H 'content-type: application/json' \\
  -d '{"event":"order.paid","amount":4200,"currency":"usd"}'

# Form POST
curl -X POST '${url}' \\
  -H 'content-type: application/x-www-form-urlencoded' \\
  -d 'event=signup&email=demo@example.com'

# Any other method
curl -X PUT '${url}/resource/42' -H 'content-type: text/plain' -d 'plain text body'`;

  const nodeSnippet = `await fetch('${url}', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: 'Bearer demo-token',
  },
  body: JSON.stringify({ hello: 'hookbox' }),
});`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send your first request"
      description="Copy the webhook URL into any service that speaks HTTP. Nothing else to install."
      width="max-w-3xl"
    >
      <div className="flex gap-1 overflow-x-auto border-b border-line pb-2">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] transition ${
              tab === entry.id ? 'bg-accent/15 text-accent' : 'text-muted hover:text-slate-200'
            }`}
          >
            {entry.icon}
            {entry.label}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-3 text-[11.5px] leading-relaxed text-slate-300">
        {tab === 'curl' ? (
          <>
            <p>
              Send a request from your terminal — the fastest way to confirm end-to-end behaviour.
            </p>
            <Snippet text={curl} />
            <p className="text-muted">Node.js / fetch equivalent:</p>
            <Snippet text={nodeSnippet} />
          </>
        ) : null}

        {tab === 'github' ? (
          <ol className="list-decimal space-y-1.5 pl-4">
            <li>
              Open your repository → <strong>Settings → Webhooks → Add webhook</strong>.
            </li>
            <li>
              <strong>Payload URL</strong>: paste <code className="mono text-accent">{url}</code>
            </li>
            <li>
              <strong>Content type</strong>: <code className="mono">application/json</code>
            </li>
            <li>
              Choose <em>Send me everything</em> or just the events you care about, then save.
            </li>
            <li>
              GitHub immediately sends a <code className="mono">ping</code> event — it should appear
              in your inbox within a second.
            </li>
          </ol>
        ) : null}

        {tab === 'stripe' ? (
          <ol className="list-decimal space-y-1.5 pl-4">
            <li>
              Stripe dashboard → <strong>Developers → Webhooks → Add endpoint</strong>.
            </li>
            <li>
              <strong>Endpoint URL</strong>: <code className="mono text-accent">{url}</code>
            </li>
            <li>
              Subscribe to events such as <code className="mono">payment_intent.succeeded</code>.
            </li>
            <li>
              Trigger a test event with <strong>Send test webhook</strong> and inspect the payload
              here.
            </li>
            <li>
              The <code className="mono">stripe-signature</code> header is masked by default; use{' '}
              <em>Show raw data</em> when you need to verify a signature locally.
            </li>
          </ol>
        ) : null}

        {tab === 'telegram' ? (
          <ol className="list-decimal space-y-1.5 pl-4">
            <li>
              Create a bot with <code className="mono">@BotFather</code> and copy its token.
            </li>
            <li>
              Register the webhook:
              <Snippet
                text={`curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=${url}"`}
              />
            </li>
            <li>Send a message to your bot — the update appears in this inbox.</li>
            <li>
              Telegram retries failed deliveries, so a burst of identical updates usually means
              HookBox returned an error. Check the status column.
            </li>
          </ol>
        ) : null}

        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-[10.5px] text-amber-100">
          Never point a real production webhook at a public debug inbox without anonymising secrets:
          HookBox stores what your sender transmits for the lifetime of the inbox.
        </div>
        <p className="flex items-center gap-2 text-[10.5px] text-muted">
          <Bell size={11} /> Tip: keep this page open — new requests appear live.
        </p>
      </div>
    </Modal>
  );
}

function Snippet({ text }: { text: string }) {
  return (
    <div className="relative">
      <pre className="mono scroll-thin overflow-x-auto rounded-md border border-line/70 bg-ink/60 p-2.5 text-[10.5px] leading-relaxed text-slate-300">
        {text}
      </pre>
      <div className="absolute right-1.5 top-1.5">
        <CopyButton value={text} size={11} title="Copy snippet" />
      </div>
    </div>
  );
}
