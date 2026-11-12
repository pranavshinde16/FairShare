import { defineConfig, devices } from '@playwright/test';

// The production build (API serving the web app) on its own port and database. See
// scripts/start-server.ts. Needs `pnpm build` first, plus Postgres and Mailpit (`pnpm db:up`).
const PORT = 3100;
export const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  // The two layouts: sidebar on desktop, bottom tabs on a phone-sized screen.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node --experimental-strip-types scripts/start-server.ts',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    env: { E2E_PORT: String(PORT) },
  },
});
