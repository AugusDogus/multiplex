import { describe, expect, test } from "bun:test";

import {
  clampPlayableSeekTarget,
  getFullTimelineDuration,
} from "./playback-time-utils";

describe("getFullTimelineDuration", () => {
  test("keeps the authoritative item duration after an offset reload", () => {
    expect(
      getFullTimelineDuration({
        mediaElementDuration: 12,
        itemDurationMs: 120_000,
        streamOffset: 108,
      }),
    ).toBe(120);
  });

  test("reconstructs the full duration when item metadata has no duration", () => {
    expect(
      getFullTimelineDuration({
        mediaElementDuration: 12,
        itemDurationMs: undefined,
        streamOffset: 108,
      }),
    ).toBe(120);
  });
});

describe("clampPlayableSeekTarget", () => {
  test("keeps ordinary seek targets unchanged", () => {
    expect(clampPlayableSeekTarget(80, 100)).toBe(80);
  });

  test("keeps an end seek inside the final playable segment", () => {
    expect(clampPlayableSeekTarget(100, 100)).toBe(99.5);
  });
});
