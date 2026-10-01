import { describe, expect, test } from "bun:test";
import { SearchAction } from "./search-actions";

describe("search actions", () => {
  test("offers navigation and appearance actions before typing", () => {
    const actions = SearchAction.matching("  ");
    expect(actions.map((action) => action.id)).toEqual([
      "home",
      "watchlist",
      "appearance",
      "light",
      "dark",
      "system",
    ]);
    expect(new Set(actions.map((action) => action.id)).size).toBe(
      actions.length,
    );
  });

  test("matches all query words across labels and aliases without case sensitivity", () => {
    expect(
      SearchAction.matching("  THEME dark ").map((action) => action.id),
    ).toEqual(["dark"]);
    expect(
      SearchAction.matching("saved later").map((action) => action.id),
    ).toEqual(["watchlist"]);
    expect(
      SearchAction.matching("install colors").map((action) => action.id),
    ).toEqual(["appearance"]);
    expect(SearchAction.matching("unmatched media title")).toEqual([]);
  });
});
