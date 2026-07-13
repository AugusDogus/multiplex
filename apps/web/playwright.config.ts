import { defineConfig, devices } from "@playwright/test";

/**
 * Watch Together end-to-end tests.
 *
 * These drive two real Plex accounts (logging in through plex.tv) against a
 * running Multiplex dev server and a live Plex server, so they need:
 *   - AUGUSDOGUS_ACCOUNT_USERNAME / AUGUSDOGUS_ACCOUNT_PASSWORD  (account A)
 *   - MULTIPLEX_ACCOUNT_EMAIL / MULTIPLEX_ACCOUNT_PASSWORD       (account B)
 *
 * We use the system Google Chrome (`channel: "chrome"`) rather than Playwright's
 * bundled Chromium because Plex streams are H.264/AAC, which the open-source
 * Chromium build cannot decode — playback would never start otherwise.
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;
const CHANNEL =
  process.env.PLAYWRIGHT_CHANNEL === "chromium"
    ? undefined
    : (process.env.PLAYWRIGHT_CHANNEL ?? "chrome");

export default defineConfig({
  testDir: "./e2e",
  // Plex login + transcoded playback are slow; give tests room.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  // These tests coordinate two accounts against shared rooms on one Plex
  // server, so they must not run in parallel with each other.
  fullyParallel: false,
  workers: 1,
  // These hit a real Plex server (live transcoding for two simultaneous
  // sessions), so allow a retry for transient startup flakiness.
  retries: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    // Bound individual actions/navigations so a missing element fails fast
    // instead of hanging until the whole-test timeout.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    channel: CHANNEL,
    launchOptions: {
      args: [
        "--no-sandbox",
        "--mute-audio",
        // Allow the lobby to auto-start playback without a user gesture, so the
        // tests exercise the real auto-start path.
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "watch-together",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], channel: CHANNEL },
    },
  ],
  webServer: {
    // Forward the port so a custom PLAYWRIGHT_PORT actually starts the dev
    // server there (otherwise the readiness check polls the wrong port).
    command: `bun run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
