import { describe, expect, test } from "bun:test";

import { shouldClaimDirectSyncplaySeek } from "./syncplay-seek-origin";

describe("shouldClaimDirectSyncplaySeek", () => {
  test("does not claim initial metadata resume positioning", () => {
    expect(
      shouldClaimDirectSyncplaySeek({
        usesOffsetTimeline: false,
        hasPendingResume: true,
      }),
    ).toBe(false);
  });

  test("claims a settled direct-play user seek", () => {
    expect(
      shouldClaimDirectSyncplaySeek({
        usesOffsetTimeline: false,
        hasPendingResume: false,
      }),
    ).toBe(true);
  });

  test("leaves offset-timeline seeks to the stream-offset observer", () => {
    expect(
      shouldClaimDirectSyncplaySeek({
        usesOffsetTimeline: true,
        hasPendingResume: false,
      }),
    ).toBe(false);
  });
});
