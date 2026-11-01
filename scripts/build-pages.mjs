#!/usr/bin/env node
/**
 * Builds the Cloudflare Pages bundle.
 *
 * Output layout (deployed as a Pages project with `_worker.js` advanced mode):
 *   dist/            → static SPA assets
 *   dist/_worker.js  → the same Worker code that runs on Workers, bundled as ESM
 *
 * In advanced mode Pages routes *every* request through `_worker.js`, and the
 * `ASSETS` binding stays available, so `worker/index.ts` needs no changes.
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

console.log('[build-pages] building SPA');
const vite = spawnSync(
  process.execPath,
  [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
  {
    cwd: root,
    stdio: 'inherit',
  },
);
if (vite.status !== 0) process.exit(vite.status ?? 1);

console.log('[build-pages] bundling worker/_worker.js');
await build({
  entryPoints: [join(root, 'worker', 'index.ts')],
  outfile: join(root, 'dist', '_worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  legalComments: 'none',
  logLevel: 'info',
});

console.log('[build-pages] done → dist/');
