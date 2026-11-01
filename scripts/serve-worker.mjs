#!/usr/bin/env node
/**
 * Boots the real Worker (built assets + local D1) on http://127.0.0.1:8787.
 * Used by the Playwright suite and by `npm run serve:worker`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8787);
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(args, options = {}) {
  return spawnSync(npx, args, { cwd: root, stdio: 'inherit', shell: false, ...options });
}

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.log('[serve-worker] dist/ missing → building first');
  const build = run(['vite', 'build']);
  if (build.status !== 0) process.exit(build.status ?? 1);
}

console.log('[serve-worker] applying local D1 migrations');
const migrate = run(['wrangler', 'd1', 'migrations', 'apply', 'hookbox-db', '--local']);
if (migrate.status !== 0) {
  console.error('[serve-worker] migrations failed');
  process.exit(migrate.status ?? 1);
}

console.log(`[serve-worker] starting wrangler dev on port ${PORT}`);
const child = spawn(
  npx,
  ['wrangler', 'dev', '--port', String(PORT), '--local', '--ip', '127.0.0.1'],
  { cwd: root, stdio: 'inherit' },
);

const shutdown = () => {
  if (!child.killed) child.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
child.on('exit', (code) => process.exit(code ?? 0));
