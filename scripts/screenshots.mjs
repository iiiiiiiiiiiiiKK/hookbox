#!/usr/bin/env node
/**
 * Captures the real UI into docs/screenshots/.
 *
 * Screenshots are taken from a running deployment (or HOOKBOX_BASE_URL) with
 * real webhook traffic — no mock data, no design mock-ups.
 *
 * Usage: node scripts/screenshots.mjs [baseUrl]
 */
import { chromium, devices } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (
  process.argv[2] ??
  process.env.HOOKBOX_BASE_URL ??
  'https://hookbox.pages.dev'
).replace(/\/+$/, '');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'screenshots');

const SAMPLES = [
  {
    method: 'POST',
    path: '?source=stripe',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1721000000,v1=deadbeef' },
    body: JSON.stringify({
      id: 'evt_1Pdemo',
      type: 'payment_intent.succeeded',
      data: { object: { amount: 4200, currency: 'usd', customer: 'cus_demo' } },
    }),
  },
  {
    method: 'POST',
    path: '/github',
    headers: { 'content-type': 'application/json', 'x-github-event': 'push' },
    body: JSON.stringify({
      ref: 'refs/heads/main',
      repository: { full_name: 'iiiiiiiiiiiiiKK/hookbox' },
      commits: [{ id: 'a1b2c3d', message: 'feat: live request stream' }],
    }),
  },
  {
    method: 'GET',
    path: '/health',
    headers: { accept: 'application/json' },
    body: undefined,
  },
  {
    method: 'PUT',
    path: '/orders/1042',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'status=shipped&carrier=dhl&api_key=sk_live_demo_secret',
  },
  {
    method: 'DELETE',
    path: '/sessions/abc',
    headers: { authorization: 'Bearer sk_live_demo_secret' },
    body: undefined,
  },
  {
    method: 'PATCH',
    path: '/users/7',
    headers: { 'content-type': 'text/plain' },
    body: 'nickname=hookbox-fan',
  },
];

async function sendSamples(webhookUrl) {
  for (const sample of SAMPLES) {
    await fetch(`${webhookUrl}${sample.path}`, {
      method: sample.method,
      headers: sample.headers,
      body: sample.body,
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

async function cleanupInbox(page) {
  try {
    const handle = await page.evaluate(() => {
      const raw = localStorage.getItem('hookbox.inboxes.v1');
      if (!raw) return null;
      const [first] = JSON.parse(raw);
      return { id: first.id, token: first.token };
    });
    if (!handle) return;
    await fetch(`${BASE}/api/inboxes/${handle.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${handle.token}` },
    });
  } catch {
    /* best effort */
  }
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();

// ---------------------------------------------------------------- desktop ---
const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  locale: 'en-US',
});
const page = await desktop.newPage();
await page.goto(`${BASE}/`);
await page.waitForSelector('text=Catch it. Inspect it.');
await page.screenshot({ path: join(outDir, '01-landing.png') });

await page.getByTestId('create-inbox').click();
const webhookUrl = (await page.getByTestId('webhook-url').textContent())?.trim();
if (!webhookUrl) throw new Error('webhook URL missing');
await sendSamples(webhookUrl);

await page.waitForFunction(
  () => document.querySelectorAll('[data-testid="request-item"]').length >= 4,
  undefined,
  { timeout: 30_000 },
);
await page.getByTestId('request-item').nth(1).click();
await page
  .waitForSelector('text=payment_intent.succeeded', { timeout: 20_000 })
  .catch(() => undefined);
await page.getByRole('button', { name: 'Body', exact: true }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: join(outDir, '02-workspace.png') });

await page.getByRole('button', { name: 'Headers', exact: true }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: join(outDir, '03-headers-masked.png') });

await page.getByRole('button', { name: 'Raw', exact: true }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: join(outDir, '04-raw-request.png') });

await page.getByRole('button', { name: 'Inbox actions' }).click();
await page.getByRole('button', { name: /Integration examples/i }).click();
await page.waitForSelector('[role="dialog"]');
await page.waitForTimeout(400);
await page.screenshot({ path: join(outDir, '05-examples.png') });
await page.keyboard.press('Escape');

await cleanupInbox(page);
await desktop.close();

// ----------------------------------------------------------------- mobile ---
const mobile = await browser.newContext({
  ...devices['iPhone 13'],
  colorScheme: 'dark',
  locale: 'en-US',
  deviceScaleFactor: 3,
});
const mobilePage = await mobile.newPage();
await mobilePage.goto(`${BASE}/`);
await mobilePage.waitForSelector('text=Catch it. Inspect it.');
await mobilePage.screenshot({ path: join(outDir, '06-mobile-landing.png') });

await mobilePage.getByTestId('create-inbox').click();
const mobileHook = (await mobilePage.getByTestId('webhook-url').textContent())?.trim();
if (!mobileHook) throw new Error('mobile webhook URL missing');
await sendSamples(mobileHook);
await mobilePage.waitForFunction(
  () => document.querySelectorAll('[data-testid="request-item"]').length >= 4,
  undefined,
  { timeout: 30_000 },
);
await mobilePage.screenshot({ path: join(outDir, '07-mobile-list.png') });

await mobilePage.getByTestId('request-item').nth(1).click();
await mobilePage.getByRole('button', { name: 'Body', exact: true }).click();
await mobilePage.waitForTimeout(500);
await mobilePage.screenshot({ path: join(outDir, '08-mobile-detail.png') });

await cleanupInbox(mobilePage);
await mobile.close();

await browser.close();
console.log(`Screenshots written to ${outDir}`);
