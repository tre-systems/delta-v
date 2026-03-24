import { defineConfig } from '@playwright/test';

// E2E_PORT avoids clashing with a separate `npm run dev` on 8787 during pre-commit.
const PORT = Number(process.env.E2E_PORT) || 8787;
const BASE_URL = `http://127.0.0.1:${PORT}`;
// Pre-commit picks a free port and must not attach to an unrelated process on that URL.
const preCommitE2e = process.env.DELTAV_PRE_COMMIT_E2E === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI && !preCommitE2e,
    timeout: 120_000,
  },
});
