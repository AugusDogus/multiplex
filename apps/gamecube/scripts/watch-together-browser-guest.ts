#!/usr/bin/env bun

import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { indexHarnessRecording } from "../../watch-together-harness/e2e/index-recording-frames";
import {
  chromeLaunchFields,
  resolveChromeLaunchTarget,
} from "../../watch-together-harness/src/chrome-launch";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const roomId = process.argv[2];
const controlPath = process.argv[3];
const baseURL = process.env.MULTIPLEX_BROWSER_BASE_URL ?? "https://multiplex.localhost";
const storageState =
  process.env.MULTIPLEX_BROWSER_GUEST_STATE ??
  path.resolve(scriptDirectory, "../../../apps/web/e2e/.auth/account-b.json");
const recordingDirectory =
  process.env.MULTIPLEX_BROWSER_GUEST_RECORD_DIR ??
  path.resolve(scriptDirectory, "../../../.watch-together-harness/gamecube-browser");
const chromeLaunch = chromeLaunchFields(resolveChromeLaunchTarget(process.env));
const seekShortcutCodes = new Map<string, string>([
  ["seek-percent-1", "Digit1"],
  ["seek-percent-2", "Digit2"],
  ["seek-percent-3", "Digit3"],
  ["seek-percent-4", "Digit4"],
  ["seek-percent-5", "Digit5"],
  ["seek-percent-6", "Digit6"],
  ["seek-percent-7", "Digit7"],
  ["seek-percent-8", "Digit8"],
  ["seek-percent-9", "Digit9"],
]);

const describeMediaURL = (value: string): string => {
  try {
    const url = new URL(value);
    const safeNames = [
      "path",
      "mediaIndex",
      "partIndex",
      "protocol",
      "directPlay",
      "directStream",
      "directStreamAudio",
      "subtitles",
      "subtitleStreamID",
      "offset",
    ];
    const safeParams = new URLSearchParams();
    for (const name of safeNames) {
      const parameter = url.searchParams.get(name);
      if (parameter !== null) safeParams.set(name, parameter);
    }
    const session = url.searchParams.get("session");
    if (session) safeParams.set("sessionSuffix", session.slice(-16));
    const query = safeParams.toString();
    return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return "<invalid media URL>";
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const describeSyncplayState = (
  direction: "sent" | "received",
  payload: string,
): string | undefined => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (!isRecord(decoded) || !isRecord(decoded.State)) return undefined;
  const playstate = isRecord(decoded.State.playstate) ? decoded.State.playstate : undefined;
  const ignoring = isRecord(decoded.State.ignoringOnTheFly)
    ? decoded.State.ignoringOnTheFly
    : undefined;
  if (!playstate) return undefined;
  const position =
    typeof playstate.position === "number" ? Math.round(playstate.position * 1000) : "unknown";
  return [
    `Browser guest Syncplay ${direction}`,
    `position-ms=${position}`,
    `paused=${String(playstate.paused)}`,
    `seek=${String(playstate.doSeek ?? false)}`,
    `authored=${String(playstate.setBy !== null && playstate.setBy !== undefined)}`,
    `client=${String(ignoring?.client ?? 0)}`,
    `server=${String(ignoring?.server ?? 0)}`,
  ].join(" ");
};

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
  channel: chromeLaunch.channel,
  executablePath: chromeLaunch.executablePath,
  args: ["--no-sandbox", "--mute-audio", "--autoplay-policy=no-user-gesture-required"],
});
let activePage: import("@playwright/test").Page | undefined;
let activeContext: import("@playwright/test").BrowserContext | undefined;
let activeRecording: import("@playwright/test").Video | undefined;

try {
  const context = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    storageState,
    recordVideo: { dir: recordingDirectory },
  });
  activeContext = context;
  const page = await context.newPage();
  activePage = page;
  activeRecording = page.video() ?? undefined;
  page.on("websocket", (socket) => {
    if (!socket.url().includes("syncplay")) return;
    socket.on("framesent", (event) => {
      if (typeof event.payload !== "string") return;
      const description = describeSyncplayState("sent", event.payload);
      if (description) console.log(description);
    });
    socket.on("framereceived", (event) => {
      if (typeof event.payload !== "string") return;
      const description = describeSyncplayState("received", event.payload);
      if (description) console.log(description);
    });
  });
  page.on("requestfailed", (request) => {
    if (!request.resourceType().includes("media")) return;
    console.log(
      `Browser guest media request failed url=${describeMediaURL(request.url())} reason=${request.failure()?.errorText ?? "unknown"}`,
    );
  });
  page.on("response", (response) => {
    const request = response.request();
    if (request.resourceType() !== "media" && !response.url().includes("/video/:/transcode/"))
      return;
    console.log(
      `Browser guest media response status=${response.status()} type=${response.headers()["content-type"] ?? "unknown"} url=${describeMediaURL(response.url())}`,
    );
    if (response.status() >= 400) {
      void response
        .text()
        .then((body) => {
          const safeBody = body
            .replace(/(X-Plex-Token(?:=|%3D))[^&\s<"]+/gi, "$1REDACTED")
            .replaceAll(/\s+/g, " ")
            .trim()
            .slice(0, 500);
          if (safeBody) {
            console.log(`Browser guest media error body=${safeBody}`);
          }
        })
        .catch(() => undefined);
    }
  });
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
  let lastRatingKey: string | undefined;
  let lastOffsetMs: number | undefined;
  let lastAdvancingOffsetMs: number | undefined;
  let lastTime = 0;
  let ready = false;
  let lastCommand = "";
  let readyDeadline = Date.now() + 120_000;
  let knownDurationSeconds = 0;

  while (!stopping) {
    const state = await video
      .evaluate((element: HTMLVideoElement) => ({
        currentTime: element.currentTime,
        currentSrc: element.currentSrc,
        duration: element.duration,
        paused: element.paused,
      }))
      .catch(() => undefined);
    if (state) {
      if (Number.isFinite(state.duration) && state.duration > 0) {
        knownDurationSeconds = state.duration;
      }
      const ratingKey = /\/library\/metadata\/(\d+)/.exec(
        decodeURIComponent(state.currentSrc),
      )?.[1];
      if (ratingKey && ratingKey !== lastRatingKey) {
        lastRatingKey = ratingKey;
        lastTime = 0;
        ready = false;
        readyDeadline = Date.now() + 120_000;
        console.log(`Browser guest rating-key=${ratingKey} initial-room=${roomId}`);
      }
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
      if (!state.paused && state.currentTime > lastTime + 0.1) {
        if (!ready) {
          ready = true;
          console.log(
            `Browser guest advancing room=${roomId}${lastRatingKey ? ` rating-key=${lastRatingKey}` : ""}`,
          );
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
          currentSrc: element.currentSrc,
          errorCode: element.error?.code ?? null,
          networkState: element.networkState,
          paused: element.paused,
          readyState: element.readyState,
        }))
        .catch(() => undefined);
      const safeDiagnostics = diagnostics
        ? {
            ...diagnostics,
            currentSrc: describeMediaURL(diagnostics.currentSrc),
          }
        : undefined;
      throw new Error(
        `Browser guest video did not advance in room ${roomId}: ${JSON.stringify(safeDiagnostics)}`,
      );
    }

    const controlFile = Bun.file(controlPath);
    if (await controlFile.exists()) {
      const command = (await controlFile.text()).trim();
      if (command && command !== lastCommand) {
        let commandTargetMs: number | undefined;
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
        } else if (seekShortcutCodes.has(command)) {
          const shortcutCode = seekShortcutCodes.get(command);
          if (!shortcutCode) {
            throw new Error(`Missing keyboard shortcut for browser guest command: ${command}`);
          }
          const seekPercentage = Number.parseInt(shortcutCode.slice(-1), 10);
          const durationSeconds = await video.evaluate(
            (element: HTMLVideoElement) => element.duration,
          );
          const effectiveDurationSeconds =
            Number.isFinite(durationSeconds) && durationSeconds > 0
              ? durationSeconds
              : knownDurationSeconds;
          if (effectiveDurationSeconds <= 0) {
            throw new Error(`Cannot seek browser guest with invalid duration: ${durationSeconds}`);
          }
          commandTargetMs = Math.round(effectiveDurationSeconds * seekPercentage * 100);
          await page.evaluate((code) => {
            document.dispatchEvent(
              new KeyboardEvent("keydown", {
                bubbles: true,
                code,
              }),
            );
          }, shortcutCode);
        } else if (command === "seek-to-end") {
          await page.evaluate(() => {
            document.dispatchEvent(
              new KeyboardEvent("keydown", {
                bubbles: true,
                code: "End",
              }),
            );
          });
        } else if (command === "disconnect") {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(1_500);
          stopping = true;
        } else {
          throw new Error(`Unknown browser guest command: ${command}`);
        }
        lastCommand = command;
        console.log(
          `Browser guest command=${command}${commandTargetMs === undefined ? "" : ` target-ms=${commandTargetMs}`} room=${roomId}`,
        );
      }
    }
    await Bun.sleep(250);
  }

  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(1_500).catch(() => undefined);
  await context.close().catch(() => undefined);
  activeContext = undefined;
} finally {
  await activePage?.keyboard.press("Escape").catch(() => undefined);
  await activePage?.waitForTimeout(1_500).catch(() => undefined);
  await activeContext?.close().catch(() => undefined);
  const recordingPath = await activeRecording?.path().catch(() => undefined);
  await browser.close();
  if (recordingPath) {
    const frameCount = await indexHarnessRecording(recordingPath);
    console.log(
      `Indexed ${frameCount} frames from ${path.relative(recordingDirectory, recordingPath)}.`,
    );
  }
}
