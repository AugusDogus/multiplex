import { describe, expect, test } from "bun:test";

import { sortContinueWatchingRows } from "./continue-watching-view";
import type { SanitizedContinueWatchingRow } from "./sanitize";

function row(
  overrides: Partial<SanitizedContinueWatchingRow> &
    Pick<SanitizedContinueWatchingRow, "id">,
): SanitizedContinueWatchingRow {
  return {
    serverId: "srv",
    serverName: null,
    serverUrl: null,
    authToken: null,
    ratingKey: overrides.id.split(":")[1] ?? "0",
    key: null,
    type: "movie",
    title: overrides.id,
    grandparentTitle: null,
    parentTitle: null,
    parentRatingKey: null,
    grandparentRatingKey: null,
    parentIndex: null,
    index: null,
    thumb: null,
    art: null,
    parentThumb: null,
    grandparentThumb: null,
    year: null,
    contentRating: null,
    viewOffset: null,
    duration: null,
    progressPercent: null,
    isCompleted: null,
    timeRemaining: null,
    lastViewedAt: null,
    listIndex: null,
    hubTitle: null,
    hubType: null,
    librarySectionTitle: null,
    librarySectionID: null,
    librarySectionKey: null,
    Media: null,
    ...overrides,
  };
}

describe("sortContinueWatchingRows", () => {
  test("orders by listIndex from the continue-watching response", () => {
    const sorted = sortContinueWatchingRows([
      row({ id: "srv:z", listIndex: 2, title: "Third" }),
      row({ id: "srv:a", listIndex: 0, title: "First" }),
      row({ id: "srv:m", listIndex: 1, title: "Second" }),
    ]);

    expect(sorted.map((item) => item.title)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  test("falls back to newest lastViewedAt when listIndex is missing", () => {
    const sorted = sortContinueWatchingRows([
      row({ id: "srv:old", lastViewedAt: 100, title: "Old" }),
      row({ id: "srv:new", lastViewedAt: 300, title: "New" }),
      row({ id: "srv:mid", lastViewedAt: 200, title: "Mid" }),
    ]);

    expect(sorted.map((item) => item.title)).toEqual(["New", "Mid", "Old"]);
  });

  test("prefers rows with listIndex over lastViewedAt-only rows", () => {
    const sorted = sortContinueWatchingRows([
      row({ id: "srv:hot", lastViewedAt: 999, title: "Hot" }),
      row({ id: "srv:listed", listIndex: 0, lastViewedAt: 1, title: "Listed" }),
    ]);

    expect(sorted.map((item) => item.title)).toEqual(["Listed", "Hot"]);
  });
});
