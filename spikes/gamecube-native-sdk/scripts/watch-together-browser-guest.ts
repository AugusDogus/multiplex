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

try {
  const context = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    storageState,
  });
  const page = await context.newPage();
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
  let lastTime = 0;
  let ready = false;
  let lastCommand = "";
  const readyDeadline = Date.now() + 120_000;

  while (!stopping) {
    const state = await video
      .evaluate((element: HTMLVideoElement) => ({
        currentTime: element.currentTime,
        paused: element.paused,
      }))
      .catch(() => undefined);
    if (state) {
      if (state.paused !== lastPaused) {
        console.log(`Browser guest playback=${state.paused ? "paused" : "playing"} room=${roomId}`);
        lastPaused = state.paused;
      }
      if (!state.paused && state.currentTime > lastTime + 0.1) {
        if (!ready) {
          ready = true;
          console.log(`Browser guest advancing room=${roomId}`);
        }
      }
      lastTime = state.currentTime;
    }

    if (!ready && Date.now() > readyDeadline) {
      throw new Error(`Browser guest video did not advance in room ${roomId}.`);
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
  await browser.close();
}
