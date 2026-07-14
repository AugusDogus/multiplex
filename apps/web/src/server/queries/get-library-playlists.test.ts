import { describe, expect, test } from "bun:test";

import { getHubItemHref } from "~/lib/plex-routes";
import { preservePlaylistSectionContext } from "./get-library-playlists";

describe("getLibraryPlaylistsQuery", () => {
  test("preserves requested section context from the list through its href", () => {
    const [playlist] = preservePlaylistSectionContext(
      [
        {
          ratingKey: "42",
          key: "/playlists/42/items",
          type: "playlist",
          title: "Road trip",
          serverId: "server-1",
        },
      ],
      7,
    );

    expect(playlist?.librarySectionID).toBe(7);
    expect(getHubItemHref("server-1", playlist!)).toBe(
      "/server/server-1/playlist/42?sectionId=7",
    );
  });
});
