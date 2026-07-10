"use client";

/**
 * Browse-surface query/mutation atoms (P5-3).
 *
 * ## Library / hub pagination
 *
 * `MediaPosterGrid` owns the page cache (TanStack `useQueries` today) and loads
 * further pages through an imperative `onLoadPage` callback — not
 * `useInfiniteQuery`. We mirror that with:
 *
 * 1. `Atom.family`-by-page query atoms keyed by
 *    `{ machineIdentifier, sectionId|hubKey, start, size, …filters }` for
 *    optional reactive reads / prefetch.
 * 2. `fetch*Page` helpers (plain HttpApi client) for the grid callback so
 *    pages are not double-cached under the atom registry.
 *
 * Surface agents keep the grid's local page cache; they do not need an
 * infinite-query atom.
 */
import {
  getNextPinnedSources,
  type PinnedSource,
  type PlaylistType,
  type PlexUserInfo,
} from "@multiplex/plex-query";
import { Effect, ManagedRuntime } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";

import {
  asContinueWatching,
  asHomeHubs,
  asHubContentPage,
  asItemPlaylists,
  asLibraryCategories,
  asLibraryCollectionsPage,
  asLibraryContentPage,
  asLibraryFilterValues,
  asLibraryHubs,
  asLibraryMeta,
  asLibraryPivots,
  asLibraryPlaylistsPage,
  asLiveTvProgramming,
  asSearchResults,
  asServerLibraries,
  asUserInfo,
  stableRecordKey,
  type HubContentPage,
  type LibraryCollectionsPage,
  type LibraryContentPage,
  type LibraryPlaylistsPage,
} from "./plex-boundary";
import {
  makePlexHttpApiClient,
  plexHttpClientLayer,
  PlexApiClient,
  type PlexHttpApiClient,
} from "./plex-api-client";
import { userInfoAtom } from "./plex-atoms";
import { ReactivityKey } from "./reactivity-keys";

// ---------------------------------------------------------------------------
// Browser HttpApi client (imperative page fetches for MediaPosterGrid)
// ---------------------------------------------------------------------------

let browserHttpClient: PlexHttpApiClient | undefined;

const getBrowserHttpClient = (): PlexHttpApiClient => {
  if (browserHttpClient) {
    return browserHttpClient;
  }
  const runtime = ManagedRuntime.make(plexHttpClientLayer);
  browserHttpClient = runtime.runSync(makePlexHttpApiClient());
  return browserHttpClient;
};

const runClient = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(effect);

// ---------------------------------------------------------------------------
// Query atoms — TTLs mirror today's tRPC staleTime / refetchInterval.
// ---------------------------------------------------------------------------

/** Home hubs row — was staleTime 0 (refetch on mount). */
export const homeHubsAtom = Atom.map(
  PlexApiClient.query("library", "getHomeHubs", {
    timeToLive: "0 seconds",
    reactivityKeys: [ReactivityKey.homeHubs],
  }),
  (result) => AsyncResult.map(result, asHomeHubs),
);

/**
 * Continue Watching across pinned libraries — was staleTime 0 /
 * refetchInterval 5s while visible. Wrap with `Atom.withRefresh` so mounted
 * views keep the previous cadence; visibility gating stays in the component.
 */
export const continueWatchingAtom = Atom.withRefresh(
  Atom.map(
    PlexApiClient.query("library", "getAllContinueWatching", {
      timeToLive: "0 seconds",
      reactivityKeys: [ReactivityKey.continueWatching],
    }),
    (result) => AsyncResult.map(result, asContinueWatching),
  ),
  "5 seconds",
);

/** Per-server continue watching — same TTL as the aggregate. */
export const continueWatchingServerAtom = Atom.family(
  (key: {
    readonly serverId: string;
    readonly contentDirectoryIds: ReadonlyArray<string>;
    readonly enabled?: boolean;
  }) => {
    if (key.enabled === false || !key.serverId) {
      return Atom.make(() => AsyncResult.initial(false));
    }
    return Atom.map(
      PlexApiClient.query("library", "getContinueWatching", {
        query: {
          serverId: key.serverId,
          contentDirectoryIds: [...key.contentDirectoryIds],
        },
        timeToLive: "0 seconds",
        reactivityKeys: [ReactivityKey.continueWatchingServer(key.serverId)],
        serializationKey: `${key.serverId}:${key.contentDirectoryIds.join(",")}`,
      }),
      (result) => AsyncResult.map(result, asContinueWatching),
    );
  },
);

/** Sidebar server libraries — was staleTime 5min. */
export const serverLibrariesAtom = Atom.map(
  PlexApiClient.query("library", "getAllServerLibraries", {
    timeToLive: "5 minutes",
    reactivityKeys: [ReactivityKey.serverLibraries],
  }),
  (result) => AsyncResult.map(result, asServerLibraries),
);

/** Library recommended hubs — was staleTime 0. */
export const libraryHubsAtom = Atom.family(
  (key: {
    readonly machineIdentifier: string;
    readonly sectionId: string;
    readonly enabled?: boolean;
  }) => {
    if (key.enabled === false || !key.machineIdentifier || !key.sectionId) {
      return Atom.make(() => AsyncResult.initial(false));
    }
    return Atom.map(
      PlexApiClient.query("library", "getLibraryHubs", {
        query: {
          machineIdentifier: key.machineIdentifier,
          sectionId: key.sectionId,
        },
        timeToLive: "0 seconds",
        reactivityKeys: [
          ReactivityKey.libraryHubs(key.machineIdentifier, key.sectionId),
        ],
        serializationKey: `${key.machineIdentifier}:${key.sectionId}`,
      }),
      (result) => AsyncResult.map(result, asLibraryHubs),
    );
  },
);

/** Library pivots / tabs. */
export const libraryPivotsAtom = Atom.family(
  (key: {
    readonly machineIdentifier: string;
    readonly sectionId: string;
    readonly enabled?: boolean;
  }) => {
    if (key.enabled === false || !key.machineIdentifier || !key.sectionId) {
      return Atom.make(() => AsyncResult.initial(false));
    }
    return Atom.map(
      PlexApiClient.query("library", "getLibraryPivots", {
        query: {
          machineIdentifier: key.machineIdentifier,
          sectionId: key.sectionId,
        },
        timeToLive: "5 minutes",
        reactivityKeys: [
          ReactivityKey.libraryPivots(key.machineIdentifier, key.sectionId),
        ],
        serializationKey: `${key.machineIdentifier}:${key.sectionId}`,
      }),
      (result) => AsyncResult.map(result, asLibraryPivots),
    );
  },
);

/** Library filter/sort metadata. */
export const libraryMetaAtom = Atom.family(
  (key: {
    readonly machineIdentifier: string;
    readonly sectionId: string;
    readonly type?: string;
    readonly enabled?: boolean;
  }) => {
    if (key.enabled === false || !key.machineIdentifier || !key.sectionId) {
      return Atom.make(() => AsyncResult.initial(false));
    }
    return Atom.map(
      PlexApiClient.query("library", "getLibraryMeta", {
        query: {
          machineIdentifier: key.machineIdentifier,
          sectionId: key.sectionId,
          ...(key.type !== undefined ? { type: key.type } : {}),
        },
        timeToLive: "5 minutes",
        reactivityKeys: [
          ReactivityKey.libraryMeta(
            key.machineIdentifier,
            key.sectionId,
            key.type,
          ),
        ],
        serializationKey: `${key.machineIdentifier}:${key.sectionId}:${key.type ?? ""}`,
      }),
      (result) => AsyncResult.map(result, asLibraryMeta),
    );
  },
);

/** Filter dropdown values — was staleTime 5min, enabled on menu open. */
export const libraryFilterValuesAtom = Atom.family(
  (key: {
    readonly machineIdentifier: string;
    readonly filterPath: string;
    readonly enabled?: boolean;
  }) => {
    if (key.enabled === false || !key.machineIdentifier || !key.filterPath) {
      return Atom.make(() => AsyncResult.initial(false));
    }
    return Atom.map(
      PlexApiClient.query("library", "getLibraryFilterValues", {
        query: {
          machineIdentifier: key.machineIdentifier,
          filterPath: key.filterPath,
        },
        timeToLive: "5 minutes",
        reactivityKeys: [
          ReactivityKey.libraryFilterValues(
            key.machineIdentifier,
            key.filterPath,
          ),
        ],
        serializationKey: `${key.machineIdentifier}:${key.filterPath}`,
      }),
      (result) => AsyncResult.map(result, asLibraryFilterValues),
    );
  },
);

/** Categories tab. */
export const libraryCategoriesAtom = Atom.family(
  (key: {
    readonly machineIdentifier: string;
    readonly sectionId: string;
    readonly start?: number;
    readonly size?: number;
    readonly enabled?: boolean;
  }) => {
    if (key.enabled === false || !key.machineIdentifier || !key.sectionId) {
      return Atom.make(() => AsyncResult.initial(false));
    }
    const start = key.start ?? 0;
    const size = key.size ?? 200;
    return Atom.map(
      PlexApiClient.query("library", "getLibraryCategories", {
        query: {
          machineIdentifier: key.machineIdentifier,
          sectionId: key.sectionId,
          start,
          size,
        },
        timeToLive: "5 minutes",
        reactivityKeys: [
          ReactivityKey.libraryCategories(key.machineIdentifier, key.sectionId),
        ],
        serializationKey: `${key.machineIdentifier}:${key.sectionId}:${start}:${size}`,
      }),
      (result) => AsyncResult.map(result, asLibraryCategories),
    );
  },
);

/**
 * One page of library content (POST + filters). Family-by-page so the poster
 * grid can request `{ start, size }` without an infinite-query atom.
 */
export const libraryContentPageAtom = Atom.family(
  (key: {
    readonly machineIdentifier: string;
    readonly sectionId: string;
    readonly start: number;
    readonly size: number;
    readonly sort: string;
    readonly type?: string;
    readonly filters?: Record<string, string>;
    readonly contentKey: string;
    readonly enabled?: boolean;
  }) => {
    if (key.enabled === false || !key.machineIdentifier || !key.sectionId) {
      return Atom.make(() => AsyncResult.initial(false));
    }
    return Atom.map(
      PlexApiClient.query("library", "getLibraryContent", {
        payload: {
          machineIdentifier: key.machineIdentifier,
          sectionId: key.sectionId,
          start: key.start,
          size: key.size,
          sort: key.sort,
          ...(key.type !== undefined ? { type: key.type } : {}),
          ...(key.filters !== undefined ? { filters: key.filters } : {}),
        },
        timeToLive: "1 minute",
        reactivityKeys: [
          ReactivityKey.libraryContent(
            key.machineIdentifier,
            key.sectionId,
            key.contentKey,
          ),
        ],
        serializationKey: [
          key.machineIdentifier,
          key.sectionId,
          key.contentKey,
          String(key.start),
          String(key.size),
        ].join(":"),
      }),
      (result) => AsyncResult.map(result, asLibraryContentPage),
    );
  },
);

/** Collections tab page. */
export const libraryCollectionsPageAtom = Atom.family(
  (key: {
    readonly machineIdentifier: string;
    readonly sectionId: string;
    readonly start: number;
    readonly size: number;
    readonly enabled?: boolean;
  }) => {
    if (key.enabled === false || !key.machineIdentifier || !key.sectionId) {
      return Atom.make(() => AsyncResult.initial(false));
    }
    return Atom.map(
      PlexApiClient.query("library", "getLibraryCollections", {
        query: {
          machineIdentifier: key.machineIdentifier,
          sectionId: key.sectionId,
          start: key.start,
          size: key.size,
        },
        timeToLive: "1 minute",
        reactivityKeys: [
          ReactivityKey.libraryCollections(
            key.machineIdentifier,
            key.sectionId,
          ),
        ],
        serializationKey: `${key.machineIdentifier}:${key.sectionId}:${key.start}:${key.size}`,
      }),
      (result) => AsyncResult.map(result, asLibraryCollectionsPage),
    );
  },
);

/** Playlists tab page. */
export const libraryPlaylistsPageAtom = Atom.family(
  (key: {
    readonly machineIdentifier: string;
    readonly sectionId: string;
    readonly start: number;
    readonly size: number;
    readonly enabled?: boolean;
  }) => {
    if (key.enabled === false || !key.machineIdentifier || !key.sectionId) {
      return Atom.make(() => AsyncResult.initial(false));
    }
    return Atom.map(
      PlexApiClient.query("library", "getLibraryPlaylists", {
        query: {
          machineIdentifier: key.machineIdentifier,
          sectionId: key.sectionId,
          start: key.start,
          size: key.size,
        },
        timeToLive: "1 minute",
        reactivityKeys: [
          ReactivityKey.libraryPlaylists(key.machineIdentifier, key.sectionId),
        ],
        serializationKey: `${key.machineIdentifier}:${key.sectionId}:${key.start}:${key.size}`,
      }),
      (result) => AsyncResult.map(result, asLibraryPlaylistsPage),
    );
  },
);

/** Hub "see all" page. */
export const hubContentPageAtom = Atom.family(
  (key: {
    readonly machineIdentifier: string;
    readonly hubKey: string;
    readonly start: number;
    readonly size: number;
    readonly enabled?: boolean;
  }) => {
    if (key.enabled === false || !key.machineIdentifier || !key.hubKey) {
      return Atom.make(() => AsyncResult.initial(false));
    }
    return Atom.map(
      PlexApiClient.query("library", "getHubContent", {
        query: {
          machineIdentifier: key.machineIdentifier,
          hubKey: key.hubKey,
          start: key.start,
          size: key.size,
        },
        timeToLive: "1 minute",
        reactivityKeys: [
          ReactivityKey.hubContent(key.machineIdentifier, key.hubKey),
        ],
        serializationKey: `${key.machineIdentifier}:${key.hubKey}:${key.start}:${key.size}`,
      }),
      (result) => AsyncResult.map(result, asHubContentPage),
    );
  },
);

/**
 * Search — family keyed by query string; was staleTime 30s. Debouncing stays
 * in the modal; empty queries return Initial (disabled).
 */
export const searchAtom = Atom.family(
  (key: {
    readonly query: string;
    readonly limit?: number;
    readonly enabled?: boolean;
  }) => {
    const q = key.query.trim();
    if (key.enabled === false || q.length === 0) {
      return Atom.make(() => AsyncResult.initial(false));
    }
    return Atom.map(
      PlexApiClient.query("search", "search", {
        query: {
          query: q,
          limit: key.limit ?? 100,
          searchTypes: ["movies", "music", "people", "tv"],
          includeCollections: true,
          includeExternalMedia: true,
        },
        timeToLive: "30 seconds",
        reactivityKeys: [ReactivityKey.search(q)],
        serializationKey: `${q}:${key.limit ?? 100}`,
      }),
      (result) => AsyncResult.map(result, asSearchResults),
    );
  },
);

/** Live TV guide for one server/provider — SSR-first; short TTL for refetch. */
export const liveTvProgrammingAtom = Atom.family(
  (key: {
    readonly machineIdentifier: string;
    readonly providerIdentifier: string;
    readonly date: string;
    readonly startTime?: Date;
    readonly endTime?: Date;
    readonly enabled?: boolean;
  }) => {
    if (
      key.enabled === false ||
      !key.machineIdentifier ||
      !key.providerIdentifier ||
      !key.date
    ) {
      return Atom.make(() => AsyncResult.initial(false));
    }
    return Atom.map(
      PlexApiClient.query("liveTv", "getServerChannelsProgramming", {
        payload: {
          machineIdentifier: key.machineIdentifier,
          providerIdentifier: key.providerIdentifier,
          date: key.date,
          ...(key.startTime !== undefined ? { startTime: key.startTime } : {}),
          ...(key.endTime !== undefined ? { endTime: key.endTime } : {}),
        },
        timeToLive: "1 minute",
        reactivityKeys: [
          ReactivityKey.liveTvProgramming(
            key.machineIdentifier,
            key.providerIdentifier,
            key.date,
          ),
        ],
        serializationKey: [
          key.machineIdentifier,
          key.providerIdentifier,
          key.date,
          key.startTime?.toISOString() ?? "",
          key.endTime?.toISOString() ?? "",
        ].join(":"),
      }),
      (result) => AsyncResult.map(result, asLiveTvProgramming),
    );
  },
);

/** All-servers live TV programming (API exists; unused by current pages). */
export const liveTvAllProgrammingAtom = Atom.family(
  (key: {
    readonly date: string;
    readonly startTime?: Date;
    readonly endTime?: Date;
    readonly enabled?: boolean;
  }) => {
    if (key.enabled === false || !key.date) {
      return Atom.make(() => AsyncResult.initial(false));
    }
    return Atom.map(
      PlexApiClient.query("liveTv", "getAllChannelsProgramming", {
        payload: {
          date: key.date,
          ...(key.startTime !== undefined ? { startTime: key.startTime } : {}),
          ...(key.endTime !== undefined ? { endTime: key.endTime } : {}),
        },
        timeToLive: "1 minute",
        reactivityKeys: [ReactivityKey.liveTvAllProgramming(key.date)],
        serializationKey: `${key.date}:${key.startTime?.toISOString() ?? ""}:${key.endTime?.toISOString() ?? ""}`,
      }),
      (result) => AsyncResult.map(result, asLiveTvProgramming),
    );
  },
);

/** Item playlists picker — was staleTime 30s, enabled when dialog open. */
export const itemPlaylistsAtom = Atom.family(
  (key: {
    readonly serverId: string;
    readonly serverUrl: string;
    readonly authToken: string;
    readonly playlistType: PlaylistType;
    readonly enabled?: boolean;
  }) => {
    if (
      key.enabled === false ||
      !key.serverId ||
      !key.serverUrl ||
      !key.authToken
    ) {
      return Atom.make(() => AsyncResult.initial(false));
    }
    return Atom.map(
      PlexApiClient.query("playback", "getItemPlaylists", {
        query: {
          serverId: key.serverId,
          serverUrl: key.serverUrl,
          authToken: key.authToken,
          playlistType: key.playlistType,
        },
        timeToLive: "30 seconds",
        reactivityKeys: [
          ReactivityKey.itemPlaylists(key.serverId, key.playlistType),
        ],
        serializationKey: `${key.serverId}:${key.playlistType}`,
      }),
      (result) => AsyncResult.map(result, asItemPlaylists),
    );
  },
);

// ---------------------------------------------------------------------------
// Mutation atoms — pass `reactivityKeys` at the call site.
// ---------------------------------------------------------------------------

export const togglePinnedSource = PlexApiClient.mutation(
  "account",
  "togglePinnedSource",
);

export const setItemWatchedState = PlexApiClient.mutation(
  "playback",
  "setItemWatchedState",
);

export const updatePlayQueue = PlexApiClient.mutation(
  "playback",
  "updatePlayQueue",
);

export const addItemToPlaylist = PlexApiClient.mutation(
  "playback",
  "addItemToPlaylist",
);

export const createPlaylistWithItem = PlexApiClient.mutation(
  "playback",
  "createPlaylistWithItem",
);

// ---------------------------------------------------------------------------
// Optimistic surfaces (sidebar pin — matches use-sidebar-pinning semantics)
// ---------------------------------------------------------------------------

export const userInfoOptimisticAtom = Atom.optimistic(userInfoAtom);

function applyPinnedSourceUpdate(
  userInfo: PlexUserInfo,
  source: PinnedSource,
  action: "pin" | "unpin",
): PlexUserInfo {
  const currentSettings = userInfo.settings ?? { otherSettings: {} };

  return {
    ...userInfo,
    settings: {
      ...currentSettings,
      sidebarSettings: {
        ...currentSettings.sidebarSettings,
        hasCompletedSetup:
          currentSettings.sidebarSettings?.hasCompletedSetup ?? true,
        pinnedSources: getNextPinnedSources(
          currentSettings.sidebarSettings?.pinnedSources ?? [],
          source,
          action,
        ),
      },
    },
  };
}

export const togglePinnedSourceOptimistic = userInfoOptimisticAtom.pipe(
  Atom.optimisticFn({
    reducer: (
      current,
      arg: {
        readonly payload: {
          readonly action: "pin" | "unpin";
          readonly source: PinnedSource;
        };
      },
    ) =>
      AsyncResult.map(current, (info) =>
        applyPinnedSourceUpdate(
          asUserInfo(info),
          arg.payload.source,
          arg.payload.action,
        ),
      ),
    fn: togglePinnedSource,
  }),
);

// ---------------------------------------------------------------------------
// Imperative page fetchers for MediaPosterGrid `onLoadPage`
// ---------------------------------------------------------------------------

export async function fetchLibraryContentPage(input: {
  readonly machineIdentifier: string;
  readonly sectionId: string;
  readonly start: number;
  readonly size: number;
  readonly sort: string;
  readonly type?: string;
  readonly filters?: Record<string, string>;
}): Promise<LibraryContentPage> {
  const client = getBrowserHttpClient();
  const raw = await runClient(
    client.library.getLibraryContent({
      payload: {
        machineIdentifier: input.machineIdentifier,
        sectionId: input.sectionId,
        start: input.start,
        size: input.size,
        sort: input.sort,
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.filters !== undefined ? { filters: input.filters } : {}),
      },
    }),
  );
  return asLibraryContentPage(raw);
}

export async function fetchLibraryCollectionsPage(input: {
  readonly machineIdentifier: string;
  readonly sectionId: string;
  readonly start: number;
  readonly size: number;
}): Promise<LibraryCollectionsPage> {
  const client = getBrowserHttpClient();
  const raw = await runClient(
    client.library.getLibraryCollections({
      query: {
        machineIdentifier: input.machineIdentifier,
        sectionId: input.sectionId,
        start: input.start,
        size: input.size,
      },
    }),
  );
  return asLibraryCollectionsPage(raw);
}

export async function fetchLibraryPlaylistsPage(input: {
  readonly machineIdentifier: string;
  readonly sectionId: string;
  readonly start: number;
  readonly size: number;
}): Promise<LibraryPlaylistsPage> {
  const client = getBrowserHttpClient();
  const raw = await runClient(
    client.library.getLibraryPlaylists({
      query: {
        machineIdentifier: input.machineIdentifier,
        sectionId: input.sectionId,
        start: input.start,
        size: input.size,
      },
    }),
  );
  return asLibraryPlaylistsPage(raw);
}

export async function fetchHubContentPage(input: {
  readonly machineIdentifier: string;
  readonly hubKey: string;
  readonly start: number;
  readonly size: number;
}): Promise<HubContentPage> {
  const client = getBrowserHttpClient();
  const raw = await runClient(
    client.library.getHubContent({
      query: {
        machineIdentifier: input.machineIdentifier,
        hubKey: input.hubKey,
        start: input.start,
        size: input.size,
      },
    }),
  );
  return asHubContentPage(raw);
}

export { stableRecordKey };
