import { describe, expect, test } from "bun:test";

import { getHubItemHref, getPlaylistHref } from "./plex-routes";

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
