import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROME_PATH;
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4322);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 4,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/en/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
