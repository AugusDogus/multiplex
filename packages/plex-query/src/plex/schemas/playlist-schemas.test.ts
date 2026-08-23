import { describe, expect, test } from "bun:test";

import { ContinueWatchingMetadata } from "./continue-watching-schemas";
import { getPlaylistTypeForItem, getPlaylistTypeForItemType } from "./playlist-schemas";

describe("playlist item type classification", () => {
  test.each([
    ["movie", "video"],
    ["episode", "video"],
    ["track", "audio"],
    ["album", "audio"],
    ["artist", "audio"],
    ["photo", "photo"],
    ["photoalbum", "photo"],
  ] as const)("classifies %s as %s", (itemType, playlistType) => {
    expect(getPlaylistTypeForItemType(itemType)).toBe(playlistType);
  });

  test.each([
    ["artist", "audio"],
    ["album", "audio"],
    ["photoalbum", "photo"],
    ["movie", "video"],
  ] as const)("classifies a %s collection from its subtype", (subtype, playlistType) => {
    expect(getPlaylistTypeForItem({ type: "collection", subtype })).toBe(playlistType);
  });

  test("falls back to the primary type without a collection subtype", () => {
    expect(getPlaylistTypeForItem({ type: "collection" })).toBe("video");
    expect(getPlaylistTypeForItem({ type: "track" })).toBe("audio");
  });

  test("preserves collection subtype in item-detail metadata", () => {
    const item = ContinueWatchingMetadata.parse({
      ratingKey: "42",
      key: "/library/metadata/42",
      guid: "collection://42",
      type: "collection",
      subtype: "artist",
      title: "Favorites",
      librarySectionTitle: "Music",
      librarySectionID: 7,
      librarySectionKey: "/library/sections/7",
    });

    expect(item.subtype).toBe("artist");
  });
});
