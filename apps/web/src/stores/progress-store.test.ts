import { beforeEach, describe, expect, test } from "bun:test";

import { toProgressPercent, useProgressStore } from "./progress-store";

const firstIdentity = { serverId: "server|one", ratingKey: "item" };
const secondIdentity = { serverId: "server", ratingKey: "one|item" };

beforeEach(() => {
  useProgressStore.getState().clearAllProgress();
});

describe("progress identity", () => {
  test("isolates matching rating keys on different servers", () => {
    const firstServer = { serverId: "server-1", ratingKey: "100" };
    const secondServer = { serverId: "server-2", ratingKey: "100" };

    useProgressStore.getState().updateItemProgress(firstServer, 25);
    useProgressStore.getState().updateItemProgress(secondServer, 75);

    expect(useProgressStore.getState().getItemProgress(firstServer)).toBe(25);
    expect(useProgressStore.getState().getItemProgress(secondServer)).toBe(75);

    useProgressStore.getState().clearItemProgress(firstServer);
    expect(
      useProgressStore.getState().getItemProgress(firstServer),
    ).toBeUndefined();
    expect(useProgressStore.getState().getItemProgress(secondServer)).toBe(75);
  });

  test("uses a collision-safe composite key", () => {
    useProgressStore.getState().updateItemProgress(firstIdentity, 30);
    useProgressStore.getState().updateItemProgress(secondIdentity, 60);

    expect(useProgressStore.getState().getItemProgress(firstIdentity)).toBe(30);
    expect(useProgressStore.getState().getItemProgress(secondIdentity)).toBe(
      60,
    );
  });
});

describe("progress numeric boundaries", () => {
  test("ignores non-finite progress updates", () => {
    useProgressStore.getState().updateItemProgress(firstIdentity, 40);
    useProgressStore.getState().updateItemProgress(firstIdentity, Number.NaN);
    useProgressStore
      .getState()
      .updateItemProgress(firstIdentity, Number.POSITIVE_INFINITY);
    useProgressStore
      .getState()
      .updateItemProgress(secondIdentity, Number.NEGATIVE_INFINITY);

    expect(useProgressStore.getState().getItemProgress(firstIdentity)).toBe(40);
    expect(
      useProgressStore.getState().getItemProgress(secondIdentity),
    ).toBeUndefined();
  });

  test("clamps finite progress updates to percentage bounds", () => {
    useProgressStore.getState().updateItemProgress(firstIdentity, -10);
    useProgressStore.getState().updateItemProgress(secondIdentity, 110);

    expect(useProgressStore.getState().getItemProgress(firstIdentity)).toBe(0);
    expect(useProgressStore.getState().getItemProgress(secondIdentity)).toBe(
      100,
    );
  });

  test("converts finite time only when duration is positive", () => {
    expect(toProgressPercent(25, 100)).toBe(25);
    expect(toProgressPercent(25, 0)).toBeNull();
    expect(toProgressPercent(25, -100)).toBeNull();
    expect(toProgressPercent(Number.NaN, 100)).toBeNull();
    expect(toProgressPercent(25, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
