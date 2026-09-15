import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const executablePath = process.env.PLAYWRIGHT_CHROME_PATH;
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4399);
const appRoot = fileURLToPath(new URL('./apps/site/', import.meta.url));
const browserEnv = { ...process.env };
// Headless Chromium's software Vulkan backend cannot create a Wayland surface.
// Isolate the test browser from the host desktop without changing the shell.
delete browserEnv.WAYLAND_DISPLAY;

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
        // Use the full browser's popup lifecycle instead of headless shell.
        channel: 'chromium',
        launchOptions: { env: browserEnv, ...(executablePath ? { executablePath } : {}) },
      },
    },
  ],
  webServer: {
    command: `npx astro preview --host 127.0.0.1 --port ${port}`,
    // Playwright must own the server, including in Astro's auto-detected AI environments.
    env: { ASTRO_PREVIEW_BACKGROUND: '0' },
    cwd: appRoot,
    url: `http://127.0.0.1:${port}/en/blog/`,
    // Never accept a dev server or a preview from another build as test evidence.
    reuseExistingServer: false,
  },
});
