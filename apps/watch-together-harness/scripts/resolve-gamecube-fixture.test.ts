import { describe, expect, test } from "bun:test";

import { firstGameCubeHomeItem } from "./resolve-gamecube-fixture";

describe("firstGameCubeHomeItem", () => {
  test("matches the native client's Continue Watching row ordering", () => {
    expect(
      firstGameCubeHomeItem([
        { hubIdentifier: "home.ondeck", items: [{ ratingKey: "ignored", title: "Ignored" }] },
        {
          hubIdentifier: "home.continueWatching",
          items: [
            { ratingKey: "current", title: "Current" },
            { ratingKey: "later", title: "Later" },
          ],
        },
      ]),
    ).toEqual({ ratingKey: "current", title: "Current" });
  });
});
