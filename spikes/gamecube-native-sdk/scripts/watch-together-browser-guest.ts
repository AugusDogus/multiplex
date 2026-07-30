#!/usr/bin/env bun

import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const roomId = process.argv[2];
const controlPath = process.argv[3];
const baseURL = process.env.MULTIPLEX_BROWSER_BASE_URL ?? "https://multiplex.localhost";
const storageState =
  process.env.MULTIPLEX_BROWSER_GUEST_STATE ??
  path.resolve(scriptDirectory, "../../../apps/web/e2e/.auth/account-b.json");

if (!roomId || !/^[A-Za-z0-9]+$/.test(roomId) || !controlPath) {
  throw new Error("Usage: bun watch-together-browser-guest.ts <room-id> <control-file>");
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--mute-audio", "--autoplay-policy=no-user-gesture-required"],
});
let activePage: import("@playwright/test").Page | undefined;

try {
  const context = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    storageState,
  });
  const page = await context.newPage();
  activePage = page;
  await page.goto("/");
  if (new URL(page.url()).pathname.startsWith("/login")) {
    throw new Error(`The browser guest session at ${storageState} is no longer authenticated.`);
  }

  let roomCard = page.locator(`a[href*="/watch-together/${roomId}"]`).first();
  if (!(await roomCard.isVisible().catch(() => false))) {
    await page.reload();
    roomCard = page.locator(`a[href*="/watch-together/${roomId}"]`).first();
  }
  await roomCard.waitFor({ state: "visible", timeout: 30_000 });
  await roomCard.click();
  await page.waitForURL(new RegExp(`/watch-together/${roomId}(?:[/?#]|$)`), {
    timeout: 30_000,
  });
  console.log(`Browser guest joined room=${roomId}`);

  const video = page.locator("video");
  await video.waitFor({ state: "visible", timeout: 120_000 });
  let lastPaused: boolean | undefined;
  let lastOffsetMs: number | undefined;
  let lastAdvancingOffsetMs: number | undefined;
  let lastTime = 0;
  let ready = false;
  let lastCommand = "";
  let lastPlayNudgeAt = 0;
  const readyDeadline = Date.now() + 120_000;

  while (!stopping) {
    const state = await video
      .evaluate((element: HTMLVideoElement) => ({
        currentTime: element.currentTime,
        currentSrc: element.currentSrc,
        paused: element.paused,
      }))
      .catch(() => undefined);
    if (state) {
      if (state.paused !== lastPaused) {
        console.log(`Browser guest playback=${state.paused ? "paused" : "playing"} room=${roomId}`);
        lastPaused = state.paused;
      }
      const offsetMatch = /[?&]offset=([0-9]+(?:\.[0-9]+)?)/.exec(state.currentSrc);
      const offsetValue = offsetMatch?.[1];
      const offsetMs = offsetValue ? Math.round(Number.parseFloat(offsetValue) * 1000) : 0;
      if (Number.isFinite(offsetMs) && offsetMs !== lastOffsetMs) {
        console.log(`Browser guest offset-ms=${offsetMs} room=${roomId}`);
        lastOffsetMs = offsetMs;
      }
      if (!ready && state.paused && Date.now() - lastPlayNudgeAt >= 2_500) {
        await video.evaluate((element: HTMLVideoElement) => element.play().catch(() => undefined));
        lastPlayNudgeAt = Date.now();
      }
      if (!state.paused && state.currentTime > lastTime + 0.1) {
        if (!ready) {
          ready = true;
          console.log(`Browser guest advancing room=${roomId}`);
        }
        if (lastOffsetMs !== undefined && lastAdvancingOffsetMs !== lastOffsetMs) {
          console.log(`Browser guest advancing offset-ms=${lastOffsetMs} room=${roomId}`);
          lastAdvancingOffsetMs = lastOffsetMs;
        }
      }
      lastTime = state.currentTime;
    }

    if (!ready && Date.now() > readyDeadline) {
      const diagnostics = await video
        .evaluate((element: HTMLVideoElement) => ({
          currentTime: element.currentTime,
          errorCode: element.error?.code ?? null,
          networkState: element.networkState,
          paused: element.paused,
          readyState: element.readyState,
        }))
        .catch(() => undefined);
      throw new Error(
        `Browser guest video did not advance in room ${roomId}: ${JSON.stringify(diagnostics)}`,
      );
    }

    const controlFile = Bun.file(controlPath);
    if (await controlFile.exists()) {
      const command = (await controlFile.text()).trim();
      if (command && command !== lastCommand) {
        if (command === "pause") {
          await video.evaluate((element: HTMLVideoElement) => element.pause());
        } else if (command === "resume") {
          await video.evaluate((element: HTMLVideoElement) =>
            element.play().catch(() => undefined),
          );
        } else if (command === "seek-10-percent") {
          await page.evaluate(() => {
            document.dispatchEvent(
              new KeyboardEvent("keydown", {
                bubbles: true,
                code: "Digit1",
              }),
            );
          });
        } else {
          throw new Error(`Unknown browser guest command: ${command}`);
        }
        lastCommand = command;
        console.log(`Browser guest command=${command} room=${roomId}`);
      }
    }
    await Bun.sleep(250);
  }

  await context.close();
} finally {
  await activePage?.keyboard.press("Escape").catch(() => undefined);
  await activePage?.waitForTimeout(1_500).catch(() => undefined);
  await browser.close();
}
