import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { harnessArtifactRoot } from "./e2e/artifact-paths";

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const chromeExecutable = process.env.WATCH_TOGETHER_HARNESS_CHROME_PATH || undefined;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "live.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 7 * 60_000,
  outputDir: harnessArtifactRoot,
  reporter: "list",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: "http://127.0.0.1:4318",
    channel: chromeExecutable ? undefined : process.env.PLAYWRIGHT_CHANNEL || undefined,
    headless: process.env.WATCH_TOGETHER_HARNESS_HEADED !== "1",
    viewport: { width: 1440, height: 1000 },
    video: "on",
    screenshot: "only-on-failure",
    trace: "off",
    launchOptions: {
      args: ["--autoplay-policy=no-user-gesture-required"],
      executablePath: chromeExecutable,
    },
  },
  webServer: {
    command: "bun src/server.ts",
    cwd: packageDirectory,
    port: 4318,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
