import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";

import type { PlexHttpApiClient } from "./plex-api-client";
import { ReactivityKey, pinnedSourceWriteKeys } from "./reactivity-keys";
import { asLibraryContentPage, stableRecordKey } from "./plex-boundary";

/**
 * Stubbed-client coverage for browse atom contracts: family key shape +
 * mutation reactivity keys. Full AtomHttpApi registry wiring is covered by
 * integration; here we assert the helpers surface agents call.
 */

type LibraryGroup = PlexHttpApiClient["library"];
type AccountGroup = PlexHttpApiClient["account"];

const succeed = <A>(value: A) => Effect.succeed(value);

describe("browse atom contracts (stubbed client)", () => {
  test("library content page family key is stable for filters", () => {
    const filters = { genre: "5", year: "2020" };
    const contentKey = [
      "machine-a",
      "4",
      "1",
      "addedAt:desc",
      stableRecordKey(filters),
    ].join("|");

    expect(contentKey).toBe("machine-a|4|1|addedAt:desc|genre=5&year=2020");
    expect(ReactivityKey.libraryContent("machine-a", "4", contentKey)).toEqual([
      "libraryContent",
      "machine-a",
      "4",
      contentKey,
    ]);
  });

  test("getLibraryContent stub returns boundary-typed page", async () => {
    const page = {
      items: [{ ratingKey: "1", serverId: "m" }],
      totalSize: 1,
      offset: 0,
    };

    const getLibraryContent = mock().mockReturnValue(succeed(page));
    const library = {
      getLibraryContent,
    } as unknown as LibraryGroup;

    const raw = await Effect.runPromise(
      library.getLibraryContent({
        payload: {
          machineIdentifier: "m",
          sectionId: "4",
          start: 50,
          size: 50,
          sort: "addedAt:desc",
        },
      }),
    );

    expect(getLibraryContent).toHaveBeenCalledTimes(1);
    expect(asLibraryContentPage(raw)).toEqual(page as never);
  });

  test("togglePinnedSource mutation call site keys cover pin side effects", () => {
    const togglePinnedSource = mock().mockReturnValue(
      succeed({ id: 1, username: "u" }),
    );
    const account = {
      togglePinnedSource,
    } as unknown as AccountGroup;

    // Surface agents pass pinnedSourceWriteKeys at the call site.
    const keys = pinnedSourceWriteKeys;
    expect(keys).toEqual([
      ReactivityKey.userInfo,
      ReactivityKey.pinnedSources,
      ReactivityKey.continueWatching,
      ReactivityKey.homeHubs,
    ]);

    void account.togglePinnedSource({
      payload: {
        action: "pin",
        source: {
          key: "k",
          sourceType: "library",
          machineIdentifier: "m",
          providerIdentifier: "com.plexapp.plugins.library",
          directoryID: "4",
          title: "Movies",
          serverFriendlyName: "Home",
          isFullOwnedServer: true,
        },
      },
    });

    expect(togglePinnedSource).toHaveBeenCalledTimes(1);
  });
});
