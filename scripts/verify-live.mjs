#!/usr/bin/env node
/**
 * Production verification: exercises the deployed HookBox with real HTTP
 * requests. Every check hits the live URL — nothing is mocked.
 *
 * Usage: node scripts/verify-live.mjs [baseUrl]
 * Defaults to https://hookbox.changyuansex.workers.dev
 */
const BASE = (
  process.argv[2] ??
  process.env.HOOKBOX_BASE_URL ??
  'https://hookbox.changyuansex.workers.dev'
).replace(/\/+$/, '');

const results = [];
let failures = 0;

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail ?? '');
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createInbox(ttlHours = 1) {
  const response = await fetch(`${BASE}/api/inboxes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ttlHours, label: 'live-verification' }),
  });
  assert(response.status === 201, `expected 201, got ${response.status}`);
  const body = await response.json();
  return body;
}

const context = {};

await check('landing page is served with security headers', async () => {
  const response = await fetch(`${BASE}/`);
  assert(response.status === 200, `status ${response.status}`);
  const html = await response.text();
  assert(html.includes('HookBox'), 'HTML does not mention HookBox');
  assert(/content-security-policy/.test([...response.headers.keys()].join(',')), 'missing CSP');
  assert(response.headers.get('x-frame-options') === 'DENY', 'missing X-Frame-Options');
  return `${html.length} bytes, CSP + frame protection`;
});

await check('asset deep link falls back to the SPA shell', async () => {
  const response = await fetch(`${BASE}/some/deep/link`);
  assert(response.status === 200, `status ${response.status}`);
  assert((await response.text()).includes('HookBox'), 'SPA fallback failed');
  return '200 on /some/deep/link';
});

await check('GET /api/health', async () => {
  const response = await fetch(`${BASE}/api/health`);
  const body = await response.json();
  assert(response.status === 200 && body.ok === true, 'health not ok');
  return `${body.name} v${body.version}`;
});

await check('GET /api/meta publishes enforcement limits', async () => {
  const response = await fetch(`${BASE}/api/meta`);
  const body = await response.json();
  assert(Array.isArray(body.limits.allowedTtlHours), 'missing limits');
  assert(response.headers.get('cache-control')?.includes('no-store'), 'missing no-store');
  return `body≤${body.limits.maxBodyBytes}B, ${body.limits.maxRequestsPerInbox} req/inbox, TTL ${body.limits.allowedTtlHours.join('/')}h`;
});

await check('creates a real inbox', async () => {
  const created = await createInbox(1);
  context.inbox = created.inbox;
  context.token = created.token;
  assert(
    created.inbox.webhookUrl.startsWith(`${BASE}/hook/`),
    `unexpected webhook URL ${created.inbox.webhookUrl}`,
  );
  assert(created.token.length >= 40, 'token too short');
  return created.inbox.webhookUrl;
});

await check('rejects unauthenticated inbox reads', async () => {
  const response = await fetch(`${BASE}/api/inboxes/${context.inbox.id}`);
  const body = await response.json();
  assert(response.status === 401 && body.error.code === 'missing_token', `got ${response.status}`);
  return '401 missing_token';
});

await check('receives a JSON POST with query and custom headers', async () => {
  const response = await fetch(`${context.inbox.webhookUrl}?source=live&tag=a&tag=b`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-live-check': 'yes',
      authorization: 'Bearer live-secret-token',
      'user-agent': 'hookbox-live-verify/1.0',
    },
    body: JSON.stringify({
      event: 'live.verification',
      amount: 1337,
      api_key: 'sk_live_should_be_masked',
    }),
  });
  const body = await response.json();
  assert(response.status === 200, `status ${response.status}`);
  assert(body.ok === true && body.bodyKind === 'json', 'ack payload unexpected');
  context.webhookRequestId = body.id;
  return `stored id=${body.id} in ${body.bodyBytes}B`;
});

await check('receives GET, PUT, PATCH and DELETE', async () => {
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(`${context.inbox.webhookUrl}/sub/${method.toLowerCase()}`, {
      method,
      headers: method === 'GET' ? {} : { 'content-type': 'text/plain' },
      body: method === 'GET' ? undefined : `body for ${method}`,
    });
    assert(response.status === 200, `${method} -> ${response.status}`);
  }
  return '4 methods accepted';
});

await check('stores a binary payload without UTF-8 mangling', async () => {
  const bytes = new Uint8Array([0x00, 0xff, 0x10, 0x7f, 0x80, 0x81, 0xfe]);
  const response = await fetch(context.inbox.webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: bytes,
  });
  const body = await response.json();
  assert(
    response.status === 200 && body.bodyKind === 'binary',
    `got ${response.status}/${body.bodyKind}`,
  );
  return `${body.bodyBytes} binary bytes`;
});

await check('lists requests newest first', async () => {
  const response = await fetch(`${BASE}/api/inboxes/${context.inbox.id}/requests`, {
    headers: { authorization: `Bearer ${context.token}` },
  });
  const body = await response.json();
  assert(response.status === 200, `status ${response.status}`);
  assert(body.total === 6, `expected 6 requests, saw ${body.total}`);
  const timestamps = body.requests.map((item) => item.receivedAt);
  assert(
    timestamps.every((value, index) => index === 0 || timestamps[index - 1] >= value),
    'not sorted',
  );
  context.requestId = context.webhookRequestId;
  context.getRequestId = body.requests.find((item) => item.method === 'GET').id;
  return `${body.total} requests`;
});

await check('masks credentials but keeps ordinary headers', async () => {
  const response = await fetch(
    `${BASE}/api/inboxes/${context.inbox.id}/requests/${context.requestId}`,
    {
      headers: { authorization: `Bearer ${context.token}` },
    },
  );
  const body = await response.json();
  assert(response.status === 200, `status ${response.status}`);
  const authHeader = body.request.headers.find(([key]) => key.toLowerCase() === 'authorization');
  assert(authHeader, 'authorization header missing');
  assert(authHeader[1] === '••••••', `authorization leaked: ${authHeader[1]}`);
  const custom = body.request.headers.find(([key]) => key.toLowerCase() === 'x-live-check');
  assert(custom[1] === 'yes', 'custom header should stay readable');
  assert(!body.request.body.text.includes('sk_live_should_be_masked'), 'JSON secret leaked');
  return 'authorization + api_key redacted';
});

await check('reveals raw data only when asked', async () => {
  const response = await fetch(
    `${BASE}/api/inboxes/${context.inbox.id}/requests/${context.requestId}?reveal=1`,
    { headers: { authorization: `Bearer ${context.token}` } },
  );
  const body = await response.json();
  assert(body.request.revealed === true, 'reveal flag not honoured');
  const authHeader = body.request.headers.find(([key]) => key.toLowerCase() === 'authorization');
  assert(authHeader[1] === 'Bearer live-secret-token', 'raw header missing');
  assert(body.request.body.text.includes('sk_live_should_be_masked'), 'raw body missing');
  return 'reveal=1 returns unredacted data';
});

await check('filters by method and searches content', async () => {
  const byMethod = await (
    await fetch(`${BASE}/api/inboxes/${context.inbox.id}/requests?method=DELETE`, {
      headers: { authorization: `Bearer ${context.token}` },
    })
  ).json();
  assert(byMethod.filtered === 1, `expected 1 DELETE, got ${byMethod.filtered}`);

  const byKeyword = await (
    await fetch(`${BASE}/api/inboxes/${context.inbox.id}/requests?q=live.verification`, {
      headers: { authorization: `Bearer ${context.token}` },
    })
  ).json();
  assert(byKeyword.filtered >= 1, 'keyword search found nothing');
  return `1 DELETE, ${byKeyword.filtered} matching keyword`;
});

await check('streams new requests over SSE', async () => {
  const controller = new AbortController();
  const response = await fetch(`${BASE}/api/inboxes/${context.inbox.id}/stream`, {
    headers: { authorization: `Bearer ${context.token}` },
    signal: controller.signal,
  });
  assert(response.status === 200, `stream status ${response.status}`);
  assert(
    (response.headers.get('content-type') ?? '').includes('text/event-stream'),
    'wrong content type',
  );

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !buffer.includes('event: hello')) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  assert(buffer.includes('event: hello'), 'no hello frame');

  await fetch(`${context.inbox.webhookUrl}/sse`, { method: 'POST', body: 'sse-live' });
  while (Date.now() < deadline && !buffer.includes('event: requests')) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  controller.abort();
  assert(buffer.includes('event: requests'), 'no request event pushed');
  return 'hello + request frame received';
});

await check('blocks SSRF targets during replay', async () => {
  const targets = [
    ['http://127.0.0.1/hook', 'blocked_address'],
    ['http://localhost:80/', 'blocked_host'],
    ['http://169.254.169.254/latest/meta-data/', 'blocked_address'],
    ['file:///etc/passwd', 'blocked_scheme'],
  ];
  for (const [target, expected] of targets) {
    const response = await fetch(
      `${BASE}/api/inboxes/${context.inbox.id}/requests/${context.requestId}/replay`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${context.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ targetUrl: target }),
      },
    );
    const body = await response.json();
    assert(response.status === 400, `${target} -> ${response.status}`);
    assert(body.error.code === expected, `${target} -> ${body.error.code}, expected ${expected}`);
  }
  return '4 private targets rejected';
});

await check('replays to a real public endpoint', async () => {
  // Replay the stored GET (example.com rejects POST with 405, which would still
  // prove the round trip but is a confusing signal for a health check).
  const response = await fetch(
    `${BASE}/api/inboxes/${context.inbox.id}/requests/${context.getRequestId}/replay`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${context.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ targetUrl: 'https://example.com/' }),
    },
  );
  const body = await response.json();
  assert(
    response.status === 200,
    `status ${response.status}: ${JSON.stringify(body).slice(0, 200)}`,
  );
  assert(
    body.replay.status >= 200 && body.replay.status < 400,
    `target responded ${body.replay.status}`,
  );
  assert(typeof body.replay.durationMs === 'number', 'missing duration');
  return `example.com -> ${body.replay.status} in ${body.replay.durationMs}ms`;
});

await check('exports masked JSON by default', async () => {
  const response = await fetch(`${BASE}/api/inboxes/${context.inbox.id}/export`, {
    headers: { authorization: `Bearer ${context.token}` },
  });
  const text = await response.text();
  assert(response.status === 200, `status ${response.status}`);
  assert(!text.includes('sk_live_should_be_masked'), 'masked export leaked a secret');
  assert(text.includes('hookbox-json'), 'export format marker missing');
  return `${text.length} bytes, secrets redacted`;
});

await check('extends TTL within the server cap', async () => {
  const response = await fetch(`${BASE}/api/inboxes/${context.inbox.id}/extend`, {
    method: 'POST',
    headers: { authorization: `Bearer ${context.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ hours: 6 }),
  });
  const body = await response.json();
  assert(response.status === 200, `status ${response.status}`);
  assert(body.inbox.expiresAt > context.inbox.expiresAt, 'expiry not extended');
  return `+${Math.round(body.extendedByMs / 60000)} minutes`;
});

await check('rejects oversized bodies with 413', async () => {
  const response = await fetch(context.inbox.webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'x'.repeat(300 * 1024),
  });
  const body = await response.json();
  assert(response.status === 413, `status ${response.status}`);
  assert(body.error.code === 'payload_too_large', `code ${body.error.code}`);
  return '413 payload_too_large';
});

await check('returns 404 for an unknown inbox', async () => {
  const response = await fetch(`${BASE}/hook/AAAAAAAAAAAAAAAA`, { method: 'POST', body: 'x' });
  assert(response.status === 404, `status ${response.status}`);
  return '404 inbox_not_found';
});

await check('deletes a single request and clears the inbox', async () => {
  const deleted = await fetch(
    `${BASE}/api/inboxes/${context.inbox.id}/requests/${context.requestId}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${context.token}` } },
  );
  assert(deleted.status === 200, `delete -> ${deleted.status}`);

  const cleared = await fetch(`${BASE}/api/inboxes/${context.inbox.id}/requests`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${context.token}` },
  });
  const body = await cleared.json();
  assert(cleared.status === 200, `clear -> ${cleared.status}`);
  const after = await (
    await fetch(`${BASE}/api/inboxes/${context.inbox.id}/requests`, {
      headers: { authorization: `Bearer ${context.token}` },
    })
  ).json();
  assert(after.total === 0, `expected empty inbox, saw ${after.total}`);
  return `deleted 1 + cleared ${body.deleted}`;
});

await check('deletes the inbox and revokes its token', async () => {
  const response = await fetch(`${BASE}/api/inboxes/${context.inbox.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${context.token}` },
  });
  assert(response.status === 200, `status ${response.status}`);
  const after = await fetch(`${BASE}/api/inboxes/${context.inbox.id}`, {
    headers: { authorization: `Bearer ${context.token}` },
  });
  assert(after.status === 404, `expected 404 after delete, got ${after.status}`);
  return 'inbox + token gone';
});

console.log('');
console.log(
  `Verified ${results.length} checks against ${BASE}: ${results.length - failures} passed, ${failures} failed.`,
);

if (failures > 0) process.exit(1);
