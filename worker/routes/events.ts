import type { Env } from '../env';
import { LIMITS } from '../env';
import { requireInbox } from '../lib/auth';
import { jsonResponse, sleep } from '../lib/http';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import { listRequests, listRequestsAfterCursor } from '../lib/store';

const SSE_HEADERS: Record<string, string> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
};

/**
 * Server-Sent Events endpoint.
 *
 * Cloudflare Workers cannot keep an unbounded connection open, so each stream
 * lives for `LIMITS.sseMaxDurationMs` and then closes; the browser reconnects
 * automatically with the last cursor. Every reconnect is a fresh, authenticated
 * request, so a revoked or expired inbox stops streaming immediately.
 */
export async function handleEventStream(
  request: Request,
  env: Env,
  url: URL,
  inboxId: string,
): Promise<Response> {
  const inbox = await requireInbox(request, env, inboxId);

  const cursorParam = url.searchParams.get('cursor');
  let cursor = cursorParam ? decodeCursor(cursorParam) : null;

  if (!cursor) {
    // Fresh subscriber: only stream requests that arrive from now on.
    const latest = await listRequests(env.DB, inbox.id, { limit: 1 });
    const newest = latest.requests[0];
    if (newest) cursor = { receivedAt: newest.receivedAt, id: newest.id };
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      request.signal?.addEventListener('abort', finish);

      send('hello', {
        inboxId: inbox.id,
        serverTime: Date.now(),
        cursor: cursor ? encodeCursor(cursor.receivedAt, cursor.id) : null,
        pollIntervalMs: LIMITS.ssePollIntervalMs,
      });

      const deadline = Date.now() + LIMITS.sseMaxDurationMs;
      let tick = 0;
      try {
        while (!closed && Date.now() < deadline) {
          const batch = await listRequestsAfterCursor(env.DB, inbox.id, cursor, 25);
          if (batch.rows.length > 0 && batch.cursor) {
            cursor = batch.cursor;
            send('requests', {
              requests: batch.rows,
              cursor: encodeCursor(batch.cursor.receivedAt, batch.cursor.id),
            });
          }
          tick += 1;
          if (tick % 8 === 0) send('ping', { t: Date.now() });
          await sleep(LIMITS.ssePollIntervalMs);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'stream failed';
        console.error('hookbox:stream_error', message);
        send('stream-error', { message: 'Live updates stopped; reconnecting…' });
      }
      finish();
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}

export function streamUnavailable(message: string): Response {
  return jsonResponse({ error: { code: 'stream_unavailable', message } }, { status: 503 });
}
