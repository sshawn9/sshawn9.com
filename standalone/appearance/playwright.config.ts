import { defineConfig } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.APPEARANCE_PORT || 4477);
const results = resolve(process.env.APPEARANCE_RESULTS || resolve(projectRoot, ".results/browser"));
const demoRoot = resolve(process.env.APPEARANCE_DEMO_ROOT || resolve(projectRoot, "apps/demo"));

export default defineConfig({
  testDir: resolve(projectRoot, "tests/browser"),
  outputDir: resolve(results, "artifacts"),
  fullyParallel: false,
  workers: 2,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 12000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: resolve(results, "report"), open: "never" }],
    ["json", { outputFile: resolve(results, "results.json") }],
  ],
  use: {
    baseURL: "http://127.0.0.1:" + port,
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    screenshot: "on",
    video: "on",
    trace: "on",
    acceptDownloads: true,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
  ],
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port " + port,
    cwd: demoRoot,
    url: "http://127.0.0.1:" + port,
    reuseExistingServer: false,
    timeout: 30000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
