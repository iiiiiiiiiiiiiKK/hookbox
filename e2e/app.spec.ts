import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * End-to-end suite.
 *
 * Every test talks to a real HookBox deployment (or the local Worker) and sends
 * genuine HTTP requests: no mocked backend, no seeded fixtures.
 */

interface InboxHandle {
  id: string;
  token: string;
  webhookUrl: string;
}

function readSavedInbox(page: Page): Promise<InboxHandle> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('hookbox.inboxes.v1');
    if (!raw) throw new Error('no saved inbox');
    const [first] = JSON.parse(raw) as Array<{ id: string; token: string }>;
    return { id: first!.id, token: first!.token, webhookUrl: '' };
  }) as Promise<InboxHandle>;
}

async function createInboxThroughUi(page: Page): Promise<string> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Catch it/i);
  await page.getByTestId('create-inbox').click();
  const urlNode = page.getByTestId('webhook-url');
  await expect(urlNode).toContainText('/hook/');
  const webhookUrl = (await urlNode.textContent())?.trim() ?? '';
  expect(webhookUrl).toMatch(/^https?:\/\/.+\/hook\/[A-Za-z0-9_-]{8,}$/);
  return webhookUrl;
}

async function cleanupInbox(request: APIRequestContext, page: Page, baseURL: string | undefined) {
  if (!baseURL) return;
  try {
    const saved = await readSavedInbox(page);
    await request.delete(`${baseURL}/api/inboxes/${saved.id}`, {
      headers: { authorization: `Bearer ${saved.token}` },
    });
  } catch {
    /* best effort cleanup */
  }
}

test.describe('HookBox workspace', () => {
  test('creates an inbox, receives a real webhook and inspects it', async ({
    page,
    request,
    baseURL,
  }) => {
    test.skip(test.info().project.name === 'mobile', 'desktop-only coverage');
    const webhookUrl = await createInboxThroughUi(page);

    // Copy-to-clipboard works for the webhook URL.
    await page.getByRole('button', { name: 'Copy', exact: true }).first().click();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(webhookUrl);

    // A genuine HTTP request from outside the browser.
    const response = await request.post(`${webhookUrl}?source=e2e&tag=a`, {
      headers: { 'x-e2e-header': 'present', authorization: 'Bearer e2e-secret-token' },
      data: { event: 'e2e.ping', amount: 42, api_key: 'sk_live_should_be_masked' },
    });
    expect(response.ok()).toBeTruthy();
    const ack = await response.json();
    expect(ack.bodyKind).toBe('json');

    // Live update (SSE) or the polling fallback must surface it.
    const item = page.getByTestId('request-item').first();
    await expect(item).toBeVisible({ timeout: 30_000 });
    await expect(item).toContainText('/hook/');
    await expect(item).toContainText('POST');

    await item.click();
    await expect(page.locator('text=POST').first()).toBeVisible();

    // Body tab renders the JSON payload with secrets masked by default.
    await page.getByRole('button', { name: 'Body', exact: true }).click();
    await expect(page.getByText('e2e.ping').first()).toBeVisible();
    await expect(page.getByText('sk_live_should_be_masked')).toHaveCount(0);

    // Headers tab: credentials are masked until you explicitly reveal them.
    await page.getByRole('button', { name: 'Headers', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'authorization', exact: true })).toBeVisible();
    await expect(page.getByText('redacted').first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'x-e2e-header', exact: true })).toBeVisible();

    await page.getByRole('button', { name: /Show raw data/i }).click();
    await expect(page.getByText('redacted').first()).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText('Bearer e2e-secret-token')).toBeVisible();
    await page.getByRole('button', { name: /Hide raw data/i }).click();

    // Search narrows the list and the empty state is explicit.
    const search = page.getByLabel('Search requests');
    await search.fill('no-such-request-xyz');
    await page.waitForTimeout(700);
    await expect(page.getByText('Waiting for the first request')).toBeVisible();
    await search.fill('');
    await expect(page.getByTestId('request-item').first()).toBeVisible({ timeout: 20_000 });

    // Single-request export downloads JSON.
    await page.getByTestId('request-item').first().click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export JSON/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^hookbox-POST-.*\.json$/);

    // Delete removes it from the list.
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Waiting for the first request')).toBeVisible({ timeout: 20_000 });

    await cleanupInbox(request, page, baseURL);
  });

  test('shows integration examples and inbox limits', async ({ page, request, baseURL }) => {
    test.skip(test.info().project.name === 'mobile', 'desktop-only coverage');
    const webhookUrl = await createInboxThroughUi(page);

    await page.getByRole('button', { name: 'Inbox actions' }).click();
    await page.getByRole('button', { name: /Integration examples/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(webhookUrl).first()).toBeVisible();

    await dialog.getByRole('button', { name: /GitHub/ }).click();
    await expect(dialog.getByText(/Settings → Webhooks/)).toBeVisible();

    await dialog.getByRole('button', { name: /Telegram/ }).click();
    await expect(dialog.getByText(/setWebhook/)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Footer exposes the published limits.
    await expect(page.getByTestId('connection-state')).toBeVisible();
    await expect(page.getByText(/requests/).first()).toBeVisible();

    await cleanupInbox(request, page, baseURL);
  });
});

test.describe('HookBox on mobile', () => {
  test('works as a single-column list → detail flow', async ({ page, request, baseURL }) => {
    test.skip(test.info().project.name !== 'mobile', 'mobile-only layout checks');
    const webhookUrl = await createInboxThroughUi(page);

    await request.post(webhookUrl, {
      headers: { 'content-type': 'application/json' },
      data: { event: 'mobile.ping', note: 'sent from the mobile e2e suite' },
    });

    const item = page.getByTestId('request-item').first();
    await expect(item).toBeVisible({ timeout: 30_000 });
    await item.click();

    // Detail replaces the list on small screens, with a back affordance.
    const back = page.getByRole('button', { name: 'Back to request list' });
    await expect(back).toBeVisible();
    await page.getByRole('button', { name: 'Body', exact: true }).click();
    await expect(page.getByText('mobile.ping').first()).toBeVisible();

    // No horizontal overflow on a 390px viewport.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await back.click();
    await expect(page.getByTestId('request-item').first()).toBeVisible();

    await cleanupInbox(request, page, baseURL);
  });
});
