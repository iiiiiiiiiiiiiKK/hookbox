/**
 * Integration suite: real HTTP requests against the real Worker bundle,
 * backed by a SQLite D1 adapter (see tests/support/harness.mjs).
 *
 * Run with: npm run test:integration
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness } from '../support/harness.mjs';

let h;
let ipSeed = 10;

function nextIp() {
  ipSeed += 1;
  return `198.51.100.${ipSeed % 250}`;
}

async function createInbox({ ttlHours = 1, ip = nextIp(), label } = {}) {
  const response = await fetch(`${h.baseUrl}/api/inboxes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ ttlHours, ...(label ? { label } : {}) }),
  });
  const body = await response.json();
  assert.equal(response.status, 201, `create failed: ${JSON.stringify(body)}`);
  return {
    id: body.inbox.id,
    token: body.token,
    inbox: body.inbox,
    ip,
    auth: { authorization: `Bearer ${body.token}`, 'cf-connecting-ip': ip },
    api: (path, init = {}) =>
      fetch(`${h.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          authorization: `Bearer ${body.token}`,
          'cf-connecting-ip': ip,
        },
      }),
    hook: (path = '', init = {}) =>
      fetch(`${h.baseUrl}/hook/${body.inbox.id}${path}`, {
        ...init,
        headers: { 'cf-connecting-ip': ip, ...(init.headers ?? {}) },
      }),
  };
}

before(async () => {
  h = await startHarness();
});

after(async () => {
  await h?.close();
});

describe('meta endpoints', () => {
  it('GET /api/health reports the service', async () => {
    const response = await fetch(`${h.baseUrl}/api/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.name, 'HookBox');
  });

  it('GET /api/meta publishes the enforced limits', async () => {
    const response = await fetch(`${h.baseUrl}/api/meta`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.limits.allowedTtlHours, [1, 6, 24]);
    assert.equal(body.limits.maxBodyBytes, 262144);
    assert.equal(body.limits.maxRequestsPerInbox, 500);
    assert.equal(body.features.realtime, 'sse');
  });

  it('unknown API routes return a structured 404', async () => {
    const response = await fetch(`${h.baseUrl}/api/nope`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error.code, 'not_found');
  });
});

describe('inbox lifecycle', () => {
  it('creates an inbox with a token, webhook URL and TTL', async () => {
    const created = await createInbox({ ttlHours: 1, label: 'integration' });
    assert.match(created.id, /^[A-Za-z0-9_-]{16}$/);
    assert.ok(created.token.length >= 40, 'token should be long');
    assert.equal(created.inbox.webhookUrl, `${h.baseUrl}/hook/${created.id}`);
    assert.equal(created.inbox.expiresAt - created.inbox.createdAt, 3_600_000);
    assert.equal(created.inbox.status, 'active');
    assert.equal(created.inbox.label, 'integration');
  });

  it('rejects unsupported TTL values', async () => {
    const response = await fetch(`${h.baseUrl}/api/inboxes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': nextIp() },
      body: JSON.stringify({ ttlHours: 999 }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'invalid_ttl');
  });

  it('stores only a hash of the access token', async () => {
    const created = await createInbox();
    const row = await h.db
      .prepare('SELECT token_hash FROM inboxes WHERE id = ?1')
      .bind(created.id)
      .first();
    assert.ok(row?.token_hash, 'token hash must exist');
    assert.notEqual(row.token_hash, created.token);
    assert.match(row.token_hash, /^[0-9a-f]{64}$/);
    const raw = JSON.stringify(row);
    assert.ok(!raw.includes(created.token), 'plaintext token must never be stored');
  });

  it('requires a valid token for reads', async () => {
    const created = await createInbox();
    const noToken = await fetch(`${h.baseUrl}/api/inboxes/${created.id}`);
    assert.equal(noToken.status, 401);
    assert.equal((await noToken.json()).error.code, 'missing_token');

    const wrongToken = await fetch(`${h.baseUrl}/api/inboxes/${created.id}`, {
      headers: { authorization: 'Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    });
    assert.equal(wrongToken.status, 401);
    assert.equal((await wrongToken.json()).error.code, 'invalid_token');

    const ok = await created.api(`/api/inboxes/${created.id}`);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).inbox.id, created.id);
  });

  it('returns 404 for unknown inbox ids and 401 across inboxes', async () => {
    const missing = await fetch(`${h.baseUrl}/api/inboxes/AAAAAAAAAAAAAAAA`, {
      headers: { authorization: 'Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    });
    assert.equal(missing.status, 404);

    const first = await createInbox();
    const second = await createInbox();
    const crossed = await fetch(`${h.baseUrl}/api/inboxes/${second.id}`, {
      headers: { authorization: `Bearer ${first.token}` },
    });
    assert.equal(crossed.status, 401, 'a token must not unlock a different inbox');
  });

  it('extends lifetime but never past the server maximum', async () => {
    const created = await createInbox({ ttlHours: 1 });
    const extended = await created.api(`/api/inboxes/${created.id}/extend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hours: 6 }),
    });
    assert.equal(extended.status, 200);
    const body = await extended.json();
    assert.ok(body.inbox.expiresAt > created.inbox.expiresAt);

    const fresh24 = await createInbox({ ttlHours: 24 });
    const capped = await fresh24.api(`/api/inboxes/${fresh24.id}/extend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hours: 24 }),
    });
    assert.equal(capped.status, 409);
    assert.equal((await capped.json()).error.code, 'ttl_capped');
  });

  it('deletes an inbox and its access', async () => {
    const created = await createInbox();
    const deleted = await created.api(`/api/inboxes/${created.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    const after1 = await created.api(`/api/inboxes/${created.id}`);
    assert.equal(after1.status, 404);
  });
});

describe('webhook receive', () => {
  it('stores a JSON POST with query, headers and body', async () => {
    const created = await createInbox();
    const sent = await created.hook('?source=harness&tag=a&tag=b', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-custom-header': 'hookbox-test',
        authorization: 'Bearer super-secret-value',
        'user-agent': 'hookbox-integration/1.0',
      },
      body: JSON.stringify({ event: 'order.paid', amount: 4200, api_key: 'sk_live_1234567890' }),
    });
    assert.equal(sent.status, 200);
    const ack = await sent.json();
    assert.equal(ack.ok, true);
    assert.equal(ack.bodyKind, 'json');

    const list = await (await created.api(`/api/inboxes/${created.id}/requests`)).json();
    assert.equal(list.total, 1);
    const summary = list.requests[0];
    assert.equal(summary.method, 'POST');
    assert.equal(summary.bodyKind, 'json');
    assert.equal(summary.queryPairCount, 3);
    assert.ok(summary.bodySize > 0);

    const detail = await (
      await created.api(`/api/inboxes/${created.id}/requests/${summary.id}`)
    ).json();
    const request = detail.request;
    assert.equal(request.path, `/hook/${created.id}`);
    assert.deepEqual(request.query, [
      ['source', 'harness'],
      ['tag', 'a'],
      ['tag', 'b'],
    ]);
    assert.equal(request.userAgent, 'hookbox-integration/1.0');

    const authHeader = request.headers.find(([key]) => key.toLowerCase() === 'authorization');
    assert.equal(authHeader[1], '••••••', 'authorization must be masked by default');
    const custom = request.headers.find(([key]) => key.toLowerCase() === 'x-custom-header');
    assert.equal(custom[1], 'hookbox-test');

    assert.ok(
      !request.body.text.includes('sk_live_1234567890'),
      'secret JSON field must be masked',
    );
    assert.ok(request.body.text.includes('••••••'));

    const revealed = await (
      await created.api(`/api/inboxes/${created.id}/requests/${summary.id}?reveal=1`)
    ).json();
    const rawAuth = revealed.request.headers.find(([key]) => key.toLowerCase() === 'authorization');
    assert.equal(rawAuth[1], 'Bearer super-secret-value');
    assert.ok(revealed.request.body.text.includes('sk_live_1234567890'));
    assert.equal(revealed.request.revealed, true);
  });

  it('accepts GET, PUT, PATCH and DELETE', async () => {
    const created = await createInbox();
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      const response = await created.hook('/resource/42', { method });
      assert.equal(response.status, 200, `${method} should be accepted`);
    }
    const list = await (await created.api(`/api/inboxes/${created.id}/requests`)).json();
    assert.equal(list.total, 4);
    assert.deepEqual(list.requests.map((item) => item.method).sort(), [
      'DELETE',
      'GET',
      'PATCH',
      'PUT',
    ]);
    assert.ok(list.requests.every((item) => item.path === `/hook/${created.id}/resource/42`));
  });

  it('parses form, XML, multipart and binary bodies', async () => {
    const created = await createInbox();

    await created.hook('', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'event=signup&email=demo%40example.com&password=hunter2hunter2',
    });

    await created.hook('', {
      method: 'POST',
      headers: { 'content-type': 'application/xml' },
      body: '<order id="7"><item>widget</item></order>',
    });

    const boundary = '----hookboxboundary';
    const multipart = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="field1"',
      '',
      'value1',
      `--${boundary}`,
      'Content-Disposition: form-data; name="upload"; filename="note.txt"',
      'Content-Type: text/plain',
      '',
      'file contents',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    await created.hook('', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: multipart,
    });

    const binary = new Uint8Array([0x00, 0xff, 0xfe, 0x01, 0x80, 0x7f]);
    await created.hook('', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: binary,
    });

    const list = await (await created.api(`/api/inboxes/${created.id}/requests`)).json();
    const kinds = list.requests.map((item) => item.bodyKind).sort();
    assert.deepEqual(kinds, ['binary', 'form', 'multipart', 'xml']);

    const byKind = Object.fromEntries(list.requests.map((item) => [item.bodyKind, item]));

    const form = await (
      await created.api(`/api/inboxes/${created.id}/requests/${byKind.form.id}`)
    ).json();
    assert.ok(form.request.body.text.includes('event=signup'));
    assert.ok(!form.request.body.text.includes('hunter2hunter2'), 'password must be masked');
    assert.equal(form.request.body.redacted, true);

    const multipartDetail = await (
      await created.api(`/api/inboxes/${created.id}/requests/${byKind.multipart.id}`)
    ).json();
    assert.equal(multipartDetail.request.body.parts.length, 2);
    assert.equal(multipartDetail.request.body.parts[0].name, 'field1');
    assert.equal(multipartDetail.request.body.parts[1].filename, 'note.txt');

    const binaryDetail = await (
      await created.api(`/api/inboxes/${created.id}/requests/${byKind.binary.id}`)
    ).json();
    assert.equal(
      binaryDetail.request.body.base64,
      undefined,
      'binary bytes stay hidden until revealed',
    );
    assert.equal(binaryDetail.request.body.redacted, true);

    const binaryRevealed = await (
      await created.api(`/api/inboxes/${created.id}/requests/${byKind.binary.id}?reveal=1`)
    ).json();
    assert.equal(binaryRevealed.request.body.base64, Buffer.from(binary).toString('base64'));
  });

  it('rejects bodies above the size limit with 413', async () => {
    const created = await createInbox();
    const oversized = 'x'.repeat(300 * 1024);
    const response = await created.hook('', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: oversized,
    });
    assert.equal(response.status, 413);
    const body = await response.json();
    assert.equal(body.error.code, 'payload_too_large');
  });

  it('rejects requests once the inbox reaches its request cap', async () => {
    const created = await createInbox();
    await h.db
      .prepare('UPDATE inboxes SET request_count = 500 WHERE id = ?1')
      .bind(created.id)
      .run();
    const response = await created.hook('', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'overflow',
    });
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error.code, 'inbox_full');
  });

  it('answers 410 once the inbox has expired', async () => {
    const created = await createInbox();
    await h.db
      .prepare('UPDATE inboxes SET expires_at = ?2 WHERE id = ?1')
      .bind(created.id, Date.now() - 1000)
      .run();
    const response = await created.hook('', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'too late',
    });
    assert.equal(response.status, 410);
    assert.equal((await response.json()).error.code, 'inbox_expired');

    const api = await created.api(`/api/inboxes/${created.id}`);
    assert.equal(api.status, 410);
  });

  it('rate limits flooding per inbox', async () => {
    const created = await createInbox();
    let limited = 0;
    let retryAfter = null;
    for (let index = 0; index < 125; index += 1) {
      const response = await created.hook('', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: `flood-${index}`,
      });
      if (response.status === 429) {
        limited += 1;
        retryAfter = response.headers.get('retry-after');
      }
    }
    assert.ok(limited > 0, 'flooding should eventually be limited');
    assert.ok(retryAfter !== null, '429 responses must include retry-after');
  });

  it('never reflects stored content as HTML', async () => {
    const created = await createInbox();
    await created.hook('', {
      method: 'POST',
      headers: { 'content-type': 'text/html' },
      body: '<script>alert("xss")</script>',
    });
    const listResponse = await created.api(`/api/inboxes/${created.id}/requests`);
    assert.match(listResponse.headers.get('content-type'), /application\/json/);
    const list = await listResponse.json();
    const detailResponse = await created.api(
      `/api/inboxes/${created.id}/requests/${list.requests[0].id}`,
    );
    assert.match(detailResponse.headers.get('content-type'), /application\/json/);
    assert.equal(detailResponse.headers.get('x-content-type-options'), 'nosniff');
  });
});

describe('request management', () => {
  it('deletes a single request and clears the rest', async () => {
    const created = await createInbox();
    for (let index = 0; index < 3; index += 1) {
      await created.hook('', { method: 'POST', body: `payload-${index}` });
    }
    let list = await (await created.api(`/api/inboxes/${created.id}/requests`)).json();
    assert.equal(list.total, 3);

    const target = list.requests[0].id;
    const deleted = await created.api(`/api/inboxes/${created.id}/requests/${target}`, {
      method: 'DELETE',
    });
    assert.equal(deleted.status, 200);
    list = await (await created.api(`/api/inboxes/${created.id}/requests`)).json();
    assert.equal(list.total, 2);

    const cleared = await created.api(`/api/inboxes/${created.id}/requests`, { method: 'DELETE' });
    assert.equal(cleared.status, 200);
    assert.equal((await cleared.json()).deleted, 2);
    list = await (await created.api(`/api/inboxes/${created.id}/requests`)).json();
    assert.equal(list.total, 0);

    const inboxRow = await h.db
      .prepare('SELECT request_count, storage_bytes FROM inboxes WHERE id = ?1')
      .bind(created.id)
      .first();
    assert.equal(inboxRow.request_count, 0);
    assert.equal(inboxRow.storage_bytes, 0);
  });

  it('filters by method, body type and keyword', async () => {
    const created = await createInbox();
    await created.hook('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'order.created', reference: 'ORD-1' }),
    });
    await created.hook('/users', {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    await created.hook('/orders', {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: 'plain text update',
    });

    const postOnly = await (
      await created.api(`/api/inboxes/${created.id}/requests?method=POST`)
    ).json();
    assert.equal(postOnly.filtered, 1);
    assert.equal(postOnly.requests[0].method, 'POST');

    const jsonOnly = await (
      await created.api(`/api/inboxes/${created.id}/requests?contentType=json`)
    ).json();
    assert.ok(jsonOnly.requests.every((item) => item.bodyKind === 'json'));

    const keyword = await (await created.api(`/api/inboxes/${created.id}/requests?q=ORD-1`)).json();
    assert.equal(keyword.filtered, 1);

    const pathFilter = await (
      await created.api(`/api/inboxes/${created.id}/requests?path=/orders`)
    ).json();
    assert.equal(pathFilter.filtered, 2);
  });

  it('paginates with an opaque cursor', async () => {
    const created = await createInbox();
    for (let index = 0; index < 12; index += 1) {
      await created.hook(`/p/${index}`, { method: 'POST', body: `item-${index}` });
    }
    const first = await (await created.api(`/api/inboxes/${created.id}/requests?limit=5`)).json();
    assert.equal(first.requests.length, 5);
    assert.ok(first.nextCursor);

    const second = await (
      await created.api(
        `/api/inboxes/${created.id}/requests?limit=5&cursor=${encodeURIComponent(first.nextCursor)}`,
      )
    ).json();
    assert.equal(second.requests.length, 5);
    const ids = new Set([...first.requests, ...second.requests].map((item) => item.id));
    assert.equal(ids.size, 10, 'pages must not overlap');

    const invalid = await created.api(`/api/inboxes/${created.id}/requests?cursor=not-a-cursor`);
    assert.equal(invalid.status, 400);
  });

  it('exports masked data by default and raw data on request', async () => {
    const created = await createInbox();
    await created.hook('', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer export-secret' },
      body: JSON.stringify({ password: 'correct-horse-battery' }),
    });

    const masked = await (await created.api(`/api/inboxes/${created.id}/export`)).json();
    assert.equal(masked.requestCount, 1);
    assert.ok(!JSON.stringify(masked).includes('correct-horse-battery'));
    assert.ok(masked.warning.toLowerCase().includes('redacted'));

    const raw = await (await created.api(`/api/inboxes/${created.id}/export?reveal=1`)).json();
    assert.ok(JSON.stringify(raw).includes('correct-horse-battery'));
  });
});

describe('replay safety', () => {
  async function seededInbox() {
    const created = await createInbox();
    await created.hook('', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'replay' }),
    });
    const list = await (await created.api(`/api/inboxes/${created.id}/requests`)).json();
    return { created, requestId: list.requests[0].id };
  }

  const cases = [
    ['http://127.0.0.1:9/hook', 'blocked_port'],
    ['http://127.0.0.1/hook', 'blocked_address'],
    ['http://localhost:8787/hook', 'blocked_host'],
    ['http://10.0.0.5/internal', 'blocked_address'],
    ['http://169.254.169.254/latest/meta-data/', 'blocked_address'],
    ['http://[::1]/', 'blocked_address'],
    ['file:///etc/passwd', 'blocked_scheme'],
    ['http://example.com:8080/api', 'blocked_port'],
    ['http://metadata.google.internal/', 'blocked_host'],
  ];

  for (const [target, expectedCode] of cases) {
    it(`blocks ${target}`, async () => {
      const { created, requestId } = await seededInbox();
      const response = await created.api(
        `/api/inboxes/${created.id}/requests/${requestId}/replay`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetUrl: target }),
        },
      );
      assert.equal(response.status, 400, `${target} must be rejected`);
      const body = await response.json();
      assert.equal(body.error.code, expectedCode);
    });
  }

  it('rejects replays without a target', async () => {
    const { created, requestId } = await seededInbox();
    const response = await created.api(`/api/inboxes/${created.id}/requests/${requestId}/replay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'missing_target');
  });

  it('rate limits replay attempts', async () => {
    const { created, requestId } = await seededInbox();
    let limited = false;
    for (let index = 0; index < 12; index += 1) {
      const response = await created.api(
        `/api/inboxes/${created.id}/requests/${requestId}/replay`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetUrl: 'http://127.0.0.1/hook' }),
        },
      );
      if (response.status === 429) limited = true;
    }
    assert.ok(limited, 'replay must be rate limited');
  });
});

describe('TTL enforcement', () => {
  it('sweeps expired inboxes and their requests out of the database', async () => {
    const created = await createInbox();
    await created.hook('', { method: 'POST', body: 'temp' });

    const live = await h.db
      .prepare('SELECT COUNT(*) AS n FROM inboxes WHERE id = ?1')
      .bind(created.id)
      .first();
    assert.equal(live.n, 1);

    await h.db
      .prepare('UPDATE inboxes SET expires_at = ?2 WHERE id = ?1')
      .bind(created.id, Date.now() - 60_000)
      .run();

    const result = await h.runCleanup();
    assert.ok(result.inboxes >= 1);

    const gone = await h.db
      .prepare('SELECT COUNT(*) AS n FROM inboxes WHERE id = ?1')
      .bind(created.id)
      .first();
    assert.equal(gone.n, 0);
    const requests = await h.db
      .prepare('SELECT COUNT(*) AS n FROM requests WHERE inbox_id = ?1')
      .bind(created.id)
      .first();
    assert.equal(requests.n, 0);
  });
});

describe('SSE stream', () => {
  it('streams newly received requests', async () => {
    const created = await createInbox();
    const controller = new AbortController();
    const response = await fetch(`${h.baseUrl}/api/inboxes/${created.id}/stream`, {
      headers: { authorization: `Bearer ${created.token}` },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Wait for the hello frame before sending traffic.
    while (!buffer.includes('event: hello')) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    assert.ok(buffer.includes('event: hello'));

    await created.hook('', { method: 'POST', body: 'stream-me' });

    const deadline = Date.now() + 8000;
    while (
      Date.now() < deadline &&
      !buffer.includes('stream-me') &&
      !buffer.includes('event: requests')
    ) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    controller.abort();
    assert.ok(buffer.includes('event: requests'), 'stream should push the new request');
  });

  it('refuses to stream without a token', async () => {
    const created = await createInbox();
    const response = await fetch(`${h.baseUrl}/api/inboxes/${created.id}/stream`);
    assert.equal(response.status, 401);
  });
});
