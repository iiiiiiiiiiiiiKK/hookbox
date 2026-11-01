/**
 * Test harness that runs the *real* Worker bundle in Node.
 *
 * The local Cloudflare runtime (workerd) cannot start on this machine, so the
 * integration suite executes `worker/index.ts` (bundled with esbuild) against a
 * D1-compatible adapter backed by node:sqlite, and serves it over real HTTP.
 * That keeps the suite honest: requests go over the wire, SQL goes through
 * SQLite, and the Worker code under test is exactly the code that deploys.
 */
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..');

class D1PreparedStatement {
  constructor(database, sql, params = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new D1PreparedStatement(this.database, this.sql, params);
  }

  #statement() {
    return this.database.raw.prepare(this.sql);
  }

  async first(column) {
    const row = this.#statement().get(...this.params);
    if (!row) return null;
    if (column) return row[column];
    return { ...row };
  }

  async all() {
    const rows = this.#statement().all(...this.params);
    return { results: rows.map((row) => ({ ...row })), success: true, meta: {} };
  }

  async run() {
    const info = this.#statement().run(...this.params);
    return {
      success: true,
      results: [],
      meta: { changes: Number(info.changes ?? 0), last_row_id: Number(info.lastInsertRowid ?? 0) },
    };
  }
}

class D1DatabaseShim {
  constructor(raw) {
    this.raw = raw;
  }

  prepare(sql) {
    return new D1PreparedStatement(this, sql);
  }

  async batch(statements) {
    const results = [];
    this.raw.exec('BEGIN');
    try {
      for (const statement of statements) {
        // D1 batch returns row sets for SELECTs and change metadata for writes.
        const isSelect = /^\s*(select|with|pragma)/i.test(statement.sql);
        results.push(isSelect ? await statement.all() : await statement.run());
      }
      this.raw.exec('COMMIT');
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
    return results;
  }

  async exec(sql) {
    this.raw.exec(sql);
    return { count: 0, duration: 0 };
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function createAssetsShim(distDir) {
  return {
    async fetch(request) {
      const url = new URL(request.url);
      const requested = url.pathname === '/' ? '/index.html' : url.pathname;
      const safe = normalize(requested).replace(/^([/\\])+/, '');
      const candidate = join(distDir, safe);
      if (candidate.startsWith(distDir) && existsSync(candidate)) {
        const info = await stat(candidate);
        if (info.isFile()) {
          const body = await readFile(candidate);
          return new Response(body, {
            status: 200,
            headers: { 'content-type': MIME[extname(candidate)] ?? 'application/octet-stream' },
          });
        }
      }
      // Single-page-app fallback, mirroring `not_found_handling`.
      const fallback = join(distDir, 'index.html');
      if (existsSync(fallback)) {
        return new Response(await readFile(fallback), {
          status: 200,
          headers: { 'content-type': MIME['.html'] },
        });
      }
      return new Response('Not found', { status: 404 });
    },
  };
}

async function applyMigrations(raw) {
  const dir = join(ROOT, 'migrations');
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(join(dir, file), 'utf8');
    raw.exec(sql);
  }
  return files;
}

export async function bundleWorker(outfile = join(ROOT, '.tmp', 'worker-index.js')) {
  await build({
    entryPoints: [join(ROOT, 'worker', 'index.ts'), join(ROOT, 'worker', 'maintenance.ts')],
    outdir: join(ROOT, '.tmp'),
    entryNames: 'worker-[name]',
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'warning',
  });
  return outfile;
}

const executionContext = { waitUntil: () => {}, passThroughOnException: () => {} };

export async function startHarness({ port = 0, pepper = 'test-pepper-0123456789abcdef' } = {}) {
  const bundlePath = await bundleWorker();
  const worker = (await import(pathToFileURL(bundlePath).href)).default;
  const maintenance = await import(pathToFileURL(join(ROOT, '.tmp', 'worker-maintenance.js')).href);

  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA journal_mode = MEMORY');
  const migrationFiles = await applyMigrations(raw);
  const db = new D1DatabaseShim(raw);
  const env = { DB: db, ASSETS: createAssetsShim(join(ROOT, 'dist')), AUTH_PEPPER: pepper };

  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
      }
      if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', '203.0.113.7');

      const url = `http://127.0.0.1:${actualPort}${req.url ?? '/'}`;
      const request = new Request(url, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
        duplex: 'half',
      });

      const response = await worker.fetch(request, env, executionContext);
      const responseHeaders = {};
      for (const [key, value] of response.headers.entries()) responseHeaders[key] = value;
      res.writeHead(response.status, responseHeaders);
      if (!response.body) {
        res.end();
        return;
      }
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { code: 'harness_error', message: String(error?.message ?? error) },
        }),
      );
    }
  });

  let actualPort = port;
  await new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      actualPort = server.address().port;
      resolve();
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${actualPort}`,
    db,
    env,
    worker,
    runCleanup: () => maintenance.runCleanup(env),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => {
          raw.close();
          resolve();
        });
      }),
  };
}
