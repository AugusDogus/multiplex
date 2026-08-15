import { describe, expect, test } from "bun:test";

import {
  getTranscodeRetryDelayMs,
  isCurrentMediaSource,
  shouldReportVideoPause,
} from "./media-player-utils";

describe("shouldReportVideoPause", () => {
  test("reports a pause from a loaded media source", () => {
    expect(
      shouldReportVideoPause({
        hasMediaError: false,
        isSourceLoading: false,
        isCurrentMediaSource: true,
        readyState: 2,
      }),
    ).toBe(true);
  });

  test("suppresses transport pauses during replacement and failure", () => {
    expect(
      shouldReportVideoPause({
        hasMediaError: false,
        isSourceLoading: false,
        isCurrentMediaSource: true,
        readyState: 0,
      }),
    ).toBe(false);
    expect(
      shouldReportVideoPause({
        hasMediaError: true,
        isSourceLoading: false,
        isCurrentMediaSource: true,
        readyState: 2,
      }),
    ).toBe(false);
    expect(
      shouldReportVideoPause({
        hasMediaError: false,
        isSourceLoading: true,
        isCurrentMediaSource: true,
        readyState: 2,
      }),
    ).toBe(false);
    expect(
      shouldReportVideoPause({
        hasMediaError: false,
        isSourceLoading: false,
        isCurrentMediaSource: false,
        readyState: 2,
      }),
    ).toBe(false);
  });
});

describe("getTranscodeRetryDelayMs", () => {
  test("backs off failed PMS starts without growing without bound", () => {
    expect([0, 1, 2, 3, 4].map(getTranscodeRetryDelayMs)).toEqual([
      500, 1_000, 2_000, 4_000, 4_000,
    ]);
  });
});

describe("isCurrentMediaSource", () => {
  test("rejects empty and obsolete source URLs", () => {
    expect(isCurrentMediaSource("", "https://plex.test/new.mp4")).toBe(false);
    expect(
      isCurrentMediaSource(
        "https://plex.test/old.mp4",
        "https://plex.test/new.mp4",
      ),
    ).toBe(false);
    expect(
      isCurrentMediaSource(
        "https://plex.test/new.mp4",
        "https://plex.test/new.mp4",
      ),
    ).toBe(true);
  });
});
