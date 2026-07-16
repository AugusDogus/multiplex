import { describe, expect, test } from "bun:test";

import {
  resetContinueWatchingProgress,
  updateContinueWatchingProgress,
  type ContinueWatchingProgressItem,
} from "./continue-watching-progress";

const items: ContinueWatchingProgressItem[] = [
  { serverId: "server-1", ratingKey: "100", duration: 100_000 },
  { serverId: "server-2", ratingKey: "100", duration: 100_000 },
];

describe("updateContinueWatchingProgress", () => {
  test("updates only the matching Plex server and item", () => {
    const result = updateContinueWatchingProgress(
      items,
      { serverId: "server-1", ratingKey: "100" },
      25,
      100,
    );

    expect(result).toEqual([
      {
        serverId: "server-1",
        ratingKey: "100",
        duration: 100_000,
        viewOffset: 25_000,
        progressPercent: 25,
        isCompleted: false,
        timeRemaining: 75_000,
      },
      items[1]!,
    ]);
  });

  test("clamps progress to the media duration", () => {
    const result = updateContinueWatchingProgress(
      items,
      { serverId: "server-1", ratingKey: "100" },
      110,
      100,
    );

    expect(result?.[0]).toMatchObject({
      viewOffset: 100_000,
      progressPercent: 100,
      isCompleted: true,
      timeRemaining: 0,
    });
  });

  test("keeps derived progress consistent with the cached duration", () => {
    const result = updateContinueWatchingProgress(
      items,
      { serverId: "server-1", ratingKey: "100" },
      90,
      120,
    );

    expect(result?.[0]).toMatchObject({
      duration: 100_000,
      viewOffset: 90_000,
      progressPercent: 90,
      isCompleted: true,
      timeRemaining: 10_000,
    });
  });

  test("ignores invalid playback measurements", () => {
    expect(
      updateContinueWatchingProgress(
        items,
        { serverId: "server-1", ratingKey: "100" },
        Number.NaN,
        100,
      ),
    ).toEqual(items);
    expect(
      updateContinueWatchingProgress(
        items,
        { serverId: "server-1", ratingKey: "100" },
        25,
        0,
      ),
    ).toEqual(items);
  });

  test("resets the matching item without requiring a duration", () => {
    const progressedItems: ContinueWatchingProgressItem[] = [
      {
        serverId: "server-1",
        ratingKey: "100",
        viewOffset: 25_000,
        progressPercent: 25,
      },
    ];
    const result = resetContinueWatchingProgress(progressedItems, {
      serverId: "server-1",
      ratingKey: "100",
    });

    expect(result).toEqual([
      {
        serverId: "server-1",
        ratingKey: "100",
        viewOffset: 0,
        progressPercent: 0,
        isCompleted: false,
        timeRemaining: undefined,
      },
    ]);
  });
});
