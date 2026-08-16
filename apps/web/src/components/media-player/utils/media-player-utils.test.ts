import { describe, expect, test } from "bun:test";

import {
  getTranscodeRetryDelayMs,
  isCurrentMediaSource,
  shouldReloadTranscodeForSeek,
  shouldRemainLoadingAfterMetadata,
  shouldReportVideoPause,
} from "./media-player-utils";

describe("shouldReportVideoPause", () => {
  test("reports a pause from a loaded media source", () => {
    expect(
      shouldReportVideoPause({
        hasMediaError: false,
        isDocumentUnloading: false,
        isSourceLoading: false,
        isCurrentMediaSource: true,
        readyState: 2,
        wasPauseRequested: true,
      }),
    ).toBe(true);
  });

  test("suppresses transport pauses during replacement and failure", () => {
    expect(
      shouldReportVideoPause({
        hasMediaError: false,
        isDocumentUnloading: false,
        isSourceLoading: false,
        isCurrentMediaSource: true,
        readyState: 0,
        wasPauseRequested: true,
      }),
    ).toBe(false);
    expect(
      shouldReportVideoPause({
        hasMediaError: true,
        isDocumentUnloading: false,
        isSourceLoading: false,
        isCurrentMediaSource: true,
        readyState: 2,
        wasPauseRequested: true,
      }),
    ).toBe(false);
    expect(
      shouldReportVideoPause({
        hasMediaError: false,
        isDocumentUnloading: false,
        isSourceLoading: true,
        isCurrentMediaSource: true,
        readyState: 2,
        wasPauseRequested: true,
      }),
    ).toBe(false);
    expect(
      shouldReportVideoPause({
        hasMediaError: false,
        isDocumentUnloading: false,
        isSourceLoading: false,
        isCurrentMediaSource: false,
        readyState: 2,
        wasPauseRequested: true,
      }),
    ).toBe(false);
  });

  test("suppresses a media pause emitted while the document unloads", () => {
    expect(
      shouldReportVideoPause({
        hasMediaError: false,
        isDocumentUnloading: true,
        isSourceLoading: false,
        isCurrentMediaSource: true,
        readyState: 2,
        wasPauseRequested: true,
      }),
    ).toBe(false);
  });

  test("suppresses a transport pause without an explicit pause request", () => {
    expect(
      shouldReportVideoPause({
        hasMediaError: false,
        isDocumentUnloading: false,
        isSourceLoading: false,
        isCurrentMediaSource: true,
        readyState: 4,
        wasPauseRequested: false,
      }),
    ).toBe(false);
  });
});

describe("shouldReloadTranscodeForSeek", () => {
  test("skips a remount when the transcode is already at the target", () => {
    expect(
      shouldReloadTranscodeForSeek({
        currentTime: 445.4,
        targetTime: 445,
      }),
    ).toBe(false);
  });

  test("reloads when Watch Together drift exceeds one second", () => {
    expect(
      shouldReloadTranscodeForSeek({
        currentTime: 445,
        targetTime: 447,
      }),
    ).toBe(true);
  });
});

describe("getTranscodeRetryDelayMs", () => {
  test("backs off failed PMS starts without growing without bound", () => {
    expect([0, 1, 2, 3, 4].map(getTranscodeRetryDelayMs)).toEqual([
      500, 1_000, 2_000, 4_000, 4_000,
    ]);
  });
});

describe("shouldRemainLoadingAfterMetadata", () => {
  test("keeps transcodes loading until media data is available", () => {
    expect(
      shouldRemainLoadingAfterMetadata({
        needsResumeSeek: false,
        videoUsesTranscode: true,
      }),
    ).toBe(true);
  });

  test("finishes metadata-only loading for direct play", () => {
    expect(
      shouldRemainLoadingAfterMetadata({
        needsResumeSeek: false,
        videoUsesTranscode: false,
      }),
    ).toBe(false);
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
