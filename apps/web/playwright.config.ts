import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests.
 *
 * `auth-gate` — document-session gate / no-ui-flash (no Plex credentials).
 * `watch-together` — two real Plex accounts against a live server. Needs:
 *   - AUGUSDOGUS_ACCOUNT_USERNAME / AUGUSDOGUS_ACCOUNT_PASSWORD  (account A)
 *   - MULTIPLEX_ACCOUNT_EMAIL / MULTIPLEX_ACCOUNT_PASSWORD       (account B)
 *
 * Watch Together uses system Google Chrome (`channel: "chrome"`) because Plex
 * streams are H.264/AAC, which Playwright's bundled Chromium cannot decode.
 * Auth-gate uses bundled Chromium — no media decode required.
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;
const CHANNEL =
  process.env.PLAYWRIGHT_CHANNEL === "chromium"
    ? undefined
    : (process.env.PLAYWRIGHT_CHANNEL ?? "chrome");

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
    trace: "retain-on-failure",
    video: "retain-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    channel: CHANNEL,
    launchOptions: {
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
    },
    {
      name: "watch-together",
      testMatch: /(?:^|\/)(?:watch-together|guest-watch-together).*\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], channel: CHANNEL },
    },
  ],
  webServer: {
    command: `bun run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
