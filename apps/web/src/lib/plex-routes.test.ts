import { describe, expect, test } from "bun:test";

import {
  getHubItemHref,
  getPlaylistHref,
  isLibrarySource,
} from "./plex-routes";

describe("playlist routes", () => {
  test("routes playlist posters to the dedicated detail page", () => {
    expect(
      getHubItemHref("server-1", {
        type: "playlist",
        ratingKey: "42",
        title: "Road trip",
        librarySectionID: 7,
      }),
    ).toBe("/server/server-1/playlist/42?sectionId=7");
  });

  test("encodes path segments and omits invalid section context", () => {
    expect(getPlaylistHref("server/one", "42/extra", 0)).toBe(
      "/server/server%2Fone/playlist/42%2Fextra",
    );
    expect(getPlaylistHref("server-1", "42", Number.NaN)).toBe(
      "/server/server-1/playlist/42",
    );
  });
});

describe("library sources", () => {
  test("accepts numeric sections belonging to the library provider", () => {
    expect(isLibrarySource("com.plexapp.plugins.library", "12")).toBe(true);
  });

  test.each(["home", "store", "movies", "watchlist"])(
    "does not treat the cloud source %s as a server library",
    (source) => {
      expect(isLibrarySource("tv.plex.provider.discover", source)).toBe(false);
      expect(isLibrarySource("com.plexapp.plugins.library", source)).toBe(
        false,
      );
    },
  );

  test("rejects numeric cloud sources and missing or malformed sections", () => {
    expect(isLibrarySource("tv.plex.provider.discover", "12")).toBe(false);
    for (const source of [undefined, null, "", "12/children", "-1", "1.5"]) {
      expect(isLibrarySource("com.plexapp.plugins.library", source)).toBe(
        false,
      );
    }
  });
});
