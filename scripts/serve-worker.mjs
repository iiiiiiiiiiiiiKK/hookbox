#!/usr/bin/env node
/**
 * Boots the real Worker (built assets + local D1) on http://127.0.0.1:8787.
 * Used by the Playwright suite and by `npm run serve:worker`.
 *
 * The Worker needs AUTH_PEPPER. It is read from the environment (CI) or from
 * `.dev.vars` (local checkout), and injected with `--var` so a fresh clone can
 * run the suite without writing secrets to disk.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8787);
const wranglerBin = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');

function readDevVarsPepper() {
  const file = join(root, '.dev.vars');
  if (!existsSync(file)) return null;
  const match = /^AUTH_PEPPER=(.+)$/m.exec(readFileSync(file, 'utf8'));
  return match ? match[1].trim() : null;
}

const pepper =
  process.env.AUTH_PEPPER?.trim() || readDevVarsPepper() || randomBytes(32).toString('hex');

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.log('[serve-worker] dist/ missing → building first');
  const build = spawnSync(process.execPath, [viteBin, 'build'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

console.log('[serve-worker] applying local D1 migrations');
const migrate = spawnSync(
  process.execPath,
  [wranglerBin, 'd1', 'migrations', 'apply', 'hookbox-db', '--local'],
  { cwd: root, stdio: 'inherit' },
);
if (migrate.status !== 0) {
  console.error('[serve-worker] migrations failed');
  process.exit(migrate.status ?? 1);
}

console.log(`[serve-worker] starting wrangler dev on port ${PORT}`);
const child = spawn(
  process.execPath,
  [
    wranglerBin,
    'dev',
    '--port',
    String(PORT),
    '--local',
    '--ip',
    '127.0.0.1',
    '--var',
    `AUTH_PEPPER:${pepper}`,
  ],
  { cwd: root, stdio: 'inherit' },
);

const shutdown = () => {
  if (!child.killed) child.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
child.on('exit', (code) => process.exit(code ?? 0));
