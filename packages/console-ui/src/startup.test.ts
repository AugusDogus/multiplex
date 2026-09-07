import { expect, test } from "bun:test";

import {
  initialModel,
  loadPairing,
  loadStartup,
  startupLoading,
  startupVisible,
  update,
} from "./core.ts";

const empty = new Uint8Array(0);

test("startup hides a cached home and ignores library input until ready", () => {
  const loading = loadStartup({ ...initialModel(), screen: "home" }, 1);
  expect(startupVisible(loading)).toBe(true);
  expect(startupLoading(loading)).toBe(true);
  expect(update(loading, { kind: "open_libraries" })).toBe(loading);
  expect(startupVisible(loadStartup(loading, 0))).toBe(false);
});

test("pairing instructions remain reachable while startup is pending", () => {
  const loading = loadStartup(initialModel(), 1);
  const pairing = loadPairing(loading, 1, new TextEncoder().encode("ABCD"), empty);
  expect(startupVisible(pairing)).toBe(false);
  expect(startupVisible(loadPairing(pairing, 2, empty, empty))).toBe(true);
});

test("retry is actionable only on a startup error", () => {
  const loading = loadStartup(initialModel(), 1);
  expect(update(loading, { kind: "retry_startup" })).toBe(loading);
  const failed = loadStartup(loading, 2);
  expect(startupLoading(failed)).toBe(false);
  expect(update(failed, { kind: "retry_startup" }).startupState).toBe("retrying");
  expect(loadStartup(failed, 2)).toBe(failed);
});

test("automatic retries keep the error stable until recovery or an explicit retry", () => {
  const failed = loadStartup(initialModel(), 3);
  expect(loadStartup(failed, 1)).toBe(failed);
  const retrying = update(failed, { kind: "retry_startup" });
  expect(startupLoading(loadStartup(retrying, 1))).toBe(true);
  expect(startupVisible(loadStartup(failed, 0))).toBe(false);
});
