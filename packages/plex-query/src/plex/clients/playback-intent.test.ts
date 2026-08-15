import { describe, expect, test } from "bun:test";

import { PlaybackIntent } from "./playback-intent";

describe("PlaybackIntent", () => {
  test("marks an unresolved play stale when a newer pause wins", () => {
    const intent = PlaybackIntent.make();
    const pendingPlay = intent.beginPlay();

    intent.pause();

    expect(intent.isCurrent(pendingPlay)).toBe(false);
    expect(intent.shouldPlay()).toBe(false);
  });

  test("does not let an older play cancel a newer play", () => {
    const intent = PlaybackIntent.make();
    const olderPlay = intent.beginPlay();
    const latestPlay = intent.beginPlay();

    expect(intent.isCurrent(olderPlay)).toBe(false);
    expect(intent.isCurrent(latestPlay)).toBe(true);
    expect(intent.shouldPlay()).toBe(true);
  });
});
