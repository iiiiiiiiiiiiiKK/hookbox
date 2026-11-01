import { defineConfig, devices } from '@playwright/test';

/**
 * E2E target selection:
 *  - `HOOKBOX_BASE_URL=https://hookbox.pages.dev npm run test:e2e` runs against
 *    the deployed product (this is how the delivery was verified).
 *  - Without the variable, the suite boots the real Worker locally on 8787.
 */
const REMOTE = process.env.HOOKBOX_BASE_URL;
const PORT = 8787;
const baseURL = REMOTE ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      // iPhone 13 metrics rendered in Chromium so CI only needs one browser binary.
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
  ],
  webServer: REMOTE
    ? undefined
    : {
        command: 'node scripts/serve-worker.mjs',
        url: `${baseURL}/api/health`,
        reuseExistingServer: true,
        timeout: 180_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
