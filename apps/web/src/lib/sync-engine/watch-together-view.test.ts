import { describe, expect, test } from "bun:test";

import type { SanitizedWatchTogetherRoomRow } from "./sanitize";
import { sortWatchTogetherRoomRows } from "./watch-together-view";

function room(
  overrides: Partial<SanitizedWatchTogetherRoomRow> &
    Pick<SanitizedWatchTogetherRoomRow, "id">,
): SanitizedWatchTogetherRoomRow {
  return {
    sourceUri: "server://test/1",
    source: null,
    title: overrides.id,
    type: "watching",
    startsAt: null,
    endsAt: null,
    updatedAt: null,
    listIndex: null,
    syncplayHost: null,
    syncplayPort: null,
    users: [],
    ...overrides,
  };
}

describe("sortWatchTogetherRoomRows", () => {
  test("restores together.plex.tv list order via listIndex", () => {
    const sorted = sortWatchTogetherRoomRows([
      room({ id: "z-room", listIndex: 2 }),
      room({ id: "a-room", listIndex: 0 }),
      room({ id: "m-room", listIndex: 1 }),
    ]);

    expect(sorted.map((row) => row.id)).toEqual(["a-room", "m-room", "z-room"]);
  });

  test("keeps indexed rooms ahead of warm-only rows without listIndex", () => {
    const sorted = sortWatchTogetherRoomRows([
      room({ id: "warmed", listIndex: null, updatedAt: 9_999 }),
      room({ id: "listed", listIndex: 0, updatedAt: 1 }),
    ]);

    expect(sorted.map((row) => row.id)).toEqual(["listed", "warmed"]);
  });

  test("falls back to newest updatedAt when listIndex is missing", () => {
    const sorted = sortWatchTogetherRoomRows([
      room({ id: "older", updatedAt: 100 }),
      room({ id: "newer", updatedAt: 200 }),
      room({ id: "mid", updatedAt: 150 }),
    ]);

    expect(sorted.map((row) => row.id)).toEqual(["newer", "mid", "older"]);
  });
});
