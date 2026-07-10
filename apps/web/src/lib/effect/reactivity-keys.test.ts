import { describe, expect, test } from "bun:test";

import {
  asContinueWatching,
  asHomeHubs,
  asHubContentPage,
  asLibraryContentPage,
  asLiveTvProgramming,
  asSearchResults,
  asServerLibraries,
  stableRecordKey,
} from "./plex-boundary";
import {
  itemMetadataWriteKeysFor,
  itemPlaylistsWriteKeysFor,
  pinnedSourceWriteKeys,
  ReactivityKey,
  watchedStateWriteKeysFor,
} from "./reactivity-keys";

describe("ReactivityKey browse vocabulary", () => {
  test("string keys are unique", () => {
    const stringKeys = [
      ReactivityKey.watchTogetherRooms,
      ReactivityKey.invitees,
      ReactivityKey.userInfo,
      ReactivityKey.homeHubs,
      ReactivityKey.continueWatching,
      ReactivityKey.serverLibraries,
      ReactivityKey.pinnedSources,
    ];
    expect(new Set(stringKeys).size).toBe(stringKeys.length);
  });

  test("parameterized keys encode identity", () => {
    expect(ReactivityKey.libraryHubs("m1", "4")).toEqual([
      "libraryHubs",
      "m1",
      "4",
    ]);
    expect(ReactivityKey.libraryContent("m1", "4", "k")).toEqual([
      "libraryContent",
      "m1",
      "4",
      "k",
    ]);
    expect(ReactivityKey.search("batman")).toEqual(["search", "batman"]);
    expect(
      ReactivityKey.liveTvProgramming("m1", "epg:1", "2026-07-10"),
    ).toEqual(["liveTvProgramming", "m1", "epg:1", "2026-07-10"]);
    expect(ReactivityKey.itemPlaylists("m1", "video")).toEqual([
      "itemPlaylists",
      "m1",
      "video",
    ]);
  });

  test("write-key helpers include expected invalidation targets", () => {
    expect(pinnedSourceWriteKeys).toContain(ReactivityKey.userInfo);
    expect(pinnedSourceWriteKeys).toContain(ReactivityKey.continueWatching);
    expect(pinnedSourceWriteKeys).toContain(ReactivityKey.homeHubs);

    const watched = watchedStateWriteKeysFor("s1", "99");
    expect(watched).toContainEqual(ReactivityKey.itemDetails("s1", "99"));
    expect(watched).toContain(ReactivityKey.continueWatching);

    expect(itemPlaylistsWriteKeysFor("s1", "video")).toEqual([
      ReactivityKey.itemPlaylists("s1", "video"),
    ]);
    expect(itemMetadataWriteKeysFor("s1", "99")).toEqual([
      ReactivityKey.itemMetadata("s1", "99"),
      ReactivityKey.itemDetails("s1", "99"),
    ]);
  });
});

describe("plex-boundary browse helpers", () => {
  test("pass through hubs / continue watching / libraries", () => {
    const hubs = [{ hubIdentifier: "home.continue" }] as never;
    expect(asHomeHubs(hubs)).toBe(hubs);

    const cw = [{ ratingKey: "1", serverId: "s" }] as never;
    expect(asContinueWatching(cw)).toBe(cw);

    const libs = [
      {
        serverId: "s",
        serverName: "Home",
        serverOwned: true,
        mediaProviders: undefined,
        error: undefined,
      },
    ] as never;
    expect(asServerLibraries(libs)).toBe(libs);
  });

  test("pass through paginated content / search / live TV", () => {
    const page = { items: [], totalSize: 0, offset: 0 } as never;
    expect(asLibraryContentPage(page)).toBe(page);
    expect(asHubContentPage(page)).toBe(page);

    const search = {
      movies: [],
      tv: [],
      music: [],
      people: [],
      collections: [],
      totalResults: 0,
    } as never;
    expect(asSearchResults(search)).toBe(search);

    const programming = [] as never;
    expect(asLiveTvProgramming(programming)).toBe(programming);
  });

  test("stableRecordKey sorts filter entries", () => {
    expect(stableRecordKey({ b: "2", a: "1" })).toBe("a=1&b=2");
    expect(stableRecordKey(undefined)).toBe("");
  });
});
