import { describe, expect, test } from "bun:test";

import { shouldCancelAutoPlay } from "./use-auto-play-next-episode";

describe("shouldCancelAutoPlay", () => {
  test.each([
    {
      name: "hook disabled",
      enabled: false,
      autoPlayEnabled: true,
      hasNextEpisode: true,
    },
    {
      name: "preference disabled",
      enabled: true,
      autoPlayEnabled: false,
      hasNextEpisode: true,
    },
    {
      name: "next episode unavailable",
      enabled: true,
      autoPlayEnabled: true,
      hasNextEpisode: false,
    },
  ])("cancels pending autoplay when $name", (input) => {
    expect(
      shouldCancelAutoPlay({
        ...input,
        isCountingDown: true,
        hasPendingEpisode: true,
      }),
    ).toBe(true);
  });

  test("does not repeatedly cancel while idle", () => {
    expect(
      shouldCancelAutoPlay({
        enabled: true,
        autoPlayEnabled: false,
        hasNextEpisode: true,
        isCountingDown: false,
        hasPendingEpisode: false,
      }),
    ).toBe(false);
  });

  test("keeps an active countdown when autoplay remains available", () => {
    expect(
      shouldCancelAutoPlay({
        enabled: true,
        autoPlayEnabled: true,
        hasNextEpisode: true,
        isCountingDown: true,
        hasPendingEpisode: true,
      }),
    ).toBe(false);
  });
});
