import { defineConfig } from '@playwright/test';
import { chromiumDesktop } from './playwright-browser';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'astro',
      use: {
        ...chromiumDesktop,
        baseURL: 'http://127.0.0.1:4323',
      },
    },
    {
      name: 'qwik',
      use: {
        ...chromiumDesktop,
        baseURL: 'http://127.0.0.1:4174',
      },
    },
  ],
  webServer: [
    {
      command: 'npm run preview:astro',
      url: 'http://127.0.0.1:4323/zh/blog/',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm run preview:qwik',
      url: 'http://127.0.0.1:4174/zh/blog/',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
