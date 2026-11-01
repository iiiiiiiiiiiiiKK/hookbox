#!/usr/bin/env node
/**
 * Deploys HookBox to Cloudflare Pages (advanced mode `_worker.js`).
 *
 * Required environment:
 *   CLOUDFLARE_API_TOKEN    token with Pages:Edit + D1:Edit
 *   CLOUDFLARE_ACCOUNT_ID   account id
 *   AUTH_PEPPER             server-side pepper (>=16 chars)
 *
 * Optional:
 *   D1_DATABASE_ID          defaults to the id in wrangler.jsonc
 *   PAGES_PROJECT           defaults to "hookbox"
 *   PAGES_BRANCH            defaults to "main"
 *
 * The script creates the Pages project when missing, wires the D1 binding and
 * the AUTH_PEPPER secret, then uploads dist/ with `wrangler pages deploy`.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const pepper = process.env.AUTH_PEPPER || undefined;
const project = process.env.PAGES_PROJECT ?? 'hookbox';
const branch = process.env.PAGES_BRANCH ?? 'main';

if (!token || !account) {
  console.error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');
  process.exit(1);
}
if (pepper && pepper.length < 16) {
  console.error('AUTH_PEPPER must be at least 16 characters');
  process.exit(1);
}

const config = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');
const databaseId = process.env.D1_DATABASE_ID ?? /"database_id"\s*:\s*"([^"]+)"/.exec(config)?.[1];
if (!databaseId) {
  console.error('Could not determine D1 database id');
  process.exit(1);
}

const api = async (path, init = {}) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
};

console.log('[deploy-pages] building');
const build = spawnSync(process.execPath, [join(root, 'scripts', 'build-pages.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);

console.log('[deploy-pages] ensuring Pages project');
const existing = await api(`/accounts/${account}/pages/projects/${project}`);
if (existing.status === 404) {
  const created = await api(`/accounts/${account}/pages/projects`, {
    method: 'POST',
    body: JSON.stringify({ name: project, production_branch: branch }),
  });
  if (!created.body?.success) {
    console.error('Failed to create Pages project:', JSON.stringify(created.body).slice(0, 500));
    process.exit(1);
  }
  console.log(`[deploy-pages] created project ${project}`);
}

const storedEnvVars = existing.body?.result?.deployment_configs?.production?.env_vars ?? {};
const hasStoredPepper = Object.keys(storedEnvVars).some(
  (name) => name.toUpperCase() === 'AUTH_PEPPER',
);
if (!hasStoredPepper && !pepper) {
  console.error(
    'This project has no AUTH_PEPPER secret yet: set AUTH_PEPPER in the environment for the first deploy',
  );
  process.exit(1);
}

const productionConfig = { d1_databases: { DB: { id: databaseId } } };
if (pepper) {
  // Rotating the pepper invalidates every existing inbox token — only pass it
  // when you actually want that (first deploy or a deliberate rotation).
  productionConfig.env_vars = { AUTH_PEPPER: { type: 'secret_text', value: pepper } };
  console.log('[deploy-pages] (re)setting AUTH_PEPPER — existing inbox tokens will be invalidated');
}

console.log('[deploy-pages] wiring bindings (D1 + AUTH_PEPPER)');
const patched = await api(`/accounts/${account}/pages/projects/${project}`, {
  method: 'PATCH',
  body: JSON.stringify({ deployment_configs: { production: productionConfig } }),
});
if (!patched.body?.success) {
  console.error('Failed to update Pages bindings:', JSON.stringify(patched.body).slice(0, 800));

  process.exit(1);
}

console.log('[deploy-pages] uploading dist/');
const deploy = spawnSync(
  process.execPath,
  [
    join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    'pages',
    'deploy',
    'dist',
    `--project-name=${project}`,
    `--branch=${branch}`,
    '--commit-dirty=true',
  ],
  { cwd: root, stdio: 'inherit' },
);
if (deploy.status !== 0) process.exit(deploy.status ?? 1);

console.log(`[deploy-pages] live at https://${project}.pages.dev`);
