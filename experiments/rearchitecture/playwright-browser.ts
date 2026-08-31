import { devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const executablePath = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  process.env.CHROME_BIN,
  '/etc/profiles/per-user/star/bin/google-chrome-stable',
].find((candidate) => candidate && existsSync(candidate));

export const chromiumDesktop = {
  ...devices['Desktop Chrome'],
  ...(executablePath ? { launchOptions: { executablePath } } : {}),
};
