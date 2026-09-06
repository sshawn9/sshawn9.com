import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const executablePath = process.env.PLAYWRIGHT_CHROME_PATH;
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4399);
const appRoot = fileURLToPath(new URL('./apps/site/', import.meta.url));

export default defineConfig({
  testDir: './tests',
  testMatch: '**/browser.spec.ts',
  testIgnore: '**/.results/**',
  outputDir: './tests/.results',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
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
    command: `npx astro preview --host 127.0.0.1 --port ${port}`,
    cwd: appRoot,
    url: `http://127.0.0.1:${port}/en/blog/`,
    // Never accept a dev server or a preview from another build as test evidence.
    reuseExistingServer: false,
  },
});
