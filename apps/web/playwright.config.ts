import { defineConfig, devices } from "@playwright/test";

import {
  chromeLaunchFields,
  resolveChromeLaunchTarget,
} from "../watch-together-harness/src/chrome-launch";

/**
 * End-to-end tests.
 *
 * `auth-gate` — document-session gate / no-ui-flash (no Plex credentials).
 * `watch-together` — two real Plex accounts against a live server. Needs:
 *   - MULTIPLEX_ACCOUNT_EMAIL / MULTIPLEX_ACCOUNT_PASSWORD         (account A)
 *   - MUTLIPLEX_ACCOUNT_EMAIL_2 / MULTIPLEX_ACCOUNT_PASSWORD_2     (account B)
 *
 * Watch Together uses system Google Chrome (`channel: "chrome"`) because Plex
 * streams are H.264/AAC, which Playwright's bundled Chromium cannot decode.
 * Auth-gate uses bundled Chromium — no media decode required.
 */
const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://multiplex.localhost";
const WEB_SERVER_URL = process.env.PLAYWRIGHT_WEB_SERVER_URL ?? BASE_URL;
const WEB_SERVER_COMMAND =
  process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ??
  `BETTER_AUTH_URL=${JSON.stringify(BASE_URL)} portless multiplex --force bun run dev`;
const CHROME_LAUNCH = chromeLaunchFields(
  resolveChromeLaunchTarget(process.env),
);

export default defineConfig({
  testDir: "./e2e",
  // Plex login + transcoded playback are slow; give those tests room.
  // Auth-gate overrides a shorter timeout below.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    channel: CHROME_LAUNCH.channel,
    launchOptions: {
      executablePath: CHROME_LAUNCH.executablePath,
      args: [
        "--no-sandbox",
        "--mute-audio",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  projects: [
    {
      name: "auth-gate",
      testMatch: /auth-gate\.spec\.ts/,
      timeout: 60_000,
      retries: 0,
      use: {
        ...devices["Desktop Chrome"],
        // Bundled Chromium is enough — no H.264 playback in these tests.
        channel: undefined,
      },
    },
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      retries: 0,
    },
    {
      name: "watch-together",
      testMatch: /(?:^|\/)(?:watch-together|guest-watch-together).*\.spec\.ts/,
      dependencies: ["setup"],
      // A functional first-attempt failure must stay visible. The harness now
      // attaches enough per-viewer evidence to distinguish product failures.
      retries: 0,
      // The two-viewer harness owns tracing for its manually created contexts.
      use: {
        ...devices["Desktop Chrome"],
        channel: CHROME_LAUNCH.channel,
        trace: "off",
      },
    },
  ],
  webServer: {
    command: WEB_SERVER_COMMAND,
    url: WEB_SERVER_URL,
    ignoreHTTPSErrors: true,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
