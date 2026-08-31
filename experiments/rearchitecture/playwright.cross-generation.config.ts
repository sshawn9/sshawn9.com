import { defineConfig } from '@playwright/test';
import { chromiumDesktop } from './playwright-browser';

export default defineConfig({
  testDir: './tests/cross-generation',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    ...chromiumDesktop,
    baseURL: 'http://127.0.0.1:4325',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview:cross-generation',
    url: 'http://127.0.0.1:4325/zh/blog/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
