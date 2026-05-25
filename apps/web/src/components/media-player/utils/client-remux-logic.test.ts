import { expect, test } from "bun:test";

import {
  SEEK_CATCH_UP_SECONDS,
  bufferedToRanges,
  clampPumpStartTime,
  computeEvictionEnd,
  isTimeBuffered,
  shouldRestartPumpForSeek,
} from "./client-remux-logic";

test("bufferedToRanges converts a TimeRanges-like object", () => {
  const ranges = bufferedToRanges({
    length: 2,
    start: (index: number) => [0, 100][index]!,
    end: (index: number) => [30, 160][index]!,
  });
  expect(ranges).toEqual([
    { start: 0, end: 30 },
    { start: 100, end: 160 },
  ]);
});

test("isTimeBuffered covers range interiors but not range tails", () => {
  const ranges = [{ start: 10, end: 40 }];
  expect(isTimeBuffered(ranges, 20)).toBe(true);
  // Slightly before the range start is tolerated (keyframe alignment).
  expect(isTimeBuffered(ranges, 9.8)).toBe(true);
  // Sitting on the tail means playback would immediately stall.
  expect(isTimeBuffered(ranges, 40)).toBe(false);
  expect(isTimeBuffered(ranges, 60)).toBe(false);
});

test("seek into buffered data does not restart the pump", () => {
  expect(
    shouldRestartPumpForSeek({
      target: 20,
      buffered: [{ start: 10, end: 40 }],
      pump: { startTime: 10, feederHead: 45, finished: false },
    }),
  ).toBe(false);
});

test("seek slightly ahead of the pump head waits for it to catch up", () => {
  expect(
    shouldRestartPumpForSeek({
      target: 50 + SEEK_CATCH_UP_SECONDS - 1,
      buffered: [{ start: 10, end: 48 }],
      pump: { startTime: 10, feederHead: 50, finished: false },
    }),
  ).toBe(false);
});

test("seek far ahead of the pump head restarts the pump", () => {
  expect(
    shouldRestartPumpForSeek({
      target: 500,
      buffered: [{ start: 10, end: 48 }],
      pump: { startTime: 10, feederHead: 50, finished: false },
    }),
  ).toBe(true);
});

test("seek behind the pump start into evicted data restarts the pump", () => {
  expect(
    shouldRestartPumpForSeek({
      target: 5,
      buffered: [{ start: 60, end: 120 }],
      pump: { startTime: 60, feederHead: 120, finished: false },
    }),
  ).toBe(true);
});

test("seek outside buffered data restarts a finished pump", () => {
  // A finished pump has fed the whole file, but eviction may have removed
  // earlier ranges; the catch-up shortcut must not apply.
  expect(
    shouldRestartPumpForSeek({
      target: 70,
      buffered: [{ start: 100, end: 160 }],
      pump: {
        startTime: 60,
        feederHead: Number.POSITIVE_INFINITY,
        finished: true,
      },
    }),
  ).toBe(true);
});

test("seek with no active pump restarts", () => {
  expect(
    shouldRestartPumpForSeek({
      target: 20,
      buffered: [],
      pump: null,
    }),
  ).toBe(true);
});

test("computeEvictionEnd skips tiny or impossible evictions", () => {
  expect(
    computeEvictionEnd({
      currentTime: 20,
      keepBehindSeconds: 30,
      earliestBufferedStart: 0,
    }),
  ).toBeNull();
  expect(
    computeEvictionEnd({
      currentTime: 100,
      keepBehindSeconds: 30,
      earliestBufferedStart: 69.5,
    }),
  ).toBeNull();
  expect(
    computeEvictionEnd({
      currentTime: 100,
      keepBehindSeconds: 30,
      earliestBufferedStart: null,
    }),
  ).toBeNull();
});

test("computeEvictionEnd removes data behind the back-buffer window", () => {
  expect(
    computeEvictionEnd({
      currentTime: 100,
      keepBehindSeconds: 30,
      earliestBufferedStart: 0,
    }),
  ).toBe(70);
});

test("clampPumpStartTime clamps into the addressable range", () => {
  expect(clampPumpStartTime(-5, 100)).toBe(0);
  expect(clampPumpStartTime(50, 100)).toBe(50);
  expect(clampPumpStartTime(150, 100)).toBe(99);
  // Unknown duration: only the lower bound applies.
  expect(clampPumpStartTime(150, null)).toBe(150);
});
