/**
 * Typed boundary helpers for permissive HttpApi success schemas.
 *
 * Phase 5-1a documents the tradeoff: large Plex metadata trees stay
 * `Schema.Unknown` on the wire because plex-query already zod-validates
 * server-side. Call sites that need the plex-query TypeScript shapes must go
 * through these helpers instead of sprinkling `as` casts.
 *
 * @module plex-boundary
 */
import type {
  CategoryWithServer,
  ContinueWatchingItemWithServer,
  EnrichedItemMetadataChild,
  FilterValue,
  GroupedSearchResults,
  HubItemWithServer,
  HubWithServer,
  ItemMetadata,
  LibraryMetaResponse,
  LibrarySectionPivots,
  PlayableEnrichedChild,
  PlayableMetadata,
  PlayQueueResponse,
  PlaylistType,
  PlexUserInfo,
  WatchTogetherRoom,
} from "@multiplex/plex-query";

/** Composite returned by `library.getItemDetails`. */
export type ItemDetails = {
  readonly item: ItemMetadata;
  readonly children: EnrichedItemMetadataChild[];
  readonly playableChildren: PlayableEnrichedChild[];
  readonly playTarget: PlayableMetadata | null;
  readonly serverName: string;
  readonly serverUrl: string | undefined;
  readonly authToken: string;
};

/** One server's libraries payload from `getAllServerLibraries`. */
export type ServerLibrariesEntry = {
  readonly serverId: string;
  readonly serverName: string;
  readonly serverOwned: boolean;
  readonly mediaProviders: unknown;
  readonly error: string | undefined;
};

export type ServerLibrariesResult = ServerLibrariesEntry[];

export type HomeHubsResult = HubWithServer[];
export type ContinueWatchingResult = ContinueWatchingItemWithServer[];
export type LibraryHubsResult = HubWithServer[];
export type LibraryPivotsResult = LibrarySectionPivots;
export type LibraryMetaResult = LibraryMetaResponse;

/** Paginated hub/library grid page (mirrors `PaginatedHubContent`). */
export type LibraryContentPage = {
  readonly items: HubItemWithServer[];
  readonly totalSize: number;
  readonly offset: number;
  readonly librarySectionTitle?: string;
};
export type LibraryCollectionsPage = LibraryContentPage;
export type LibraryPlaylistsPage = LibraryContentPage;
export type HubContentPage = LibraryContentPage;

export type LibraryCategoriesResult = {
  readonly categories: CategoryWithServer[];
  readonly totalSize: number;
  readonly offset: number;
};
export type LibraryFilterValuesResult = FilterValue[];
export type SearchResults = GroupedSearchResults;

/** Live TV channel lineups (mirrors `AllChannelsProgrammingResult`). */
export type LiveTvProgrammingResult = ReadonlyArray<{
  readonly channel: {
    readonly id: string;
    readonly gridKey: string;
    readonly vcn: string;
    readonly thumb: string;
    readonly title: string;
    readonly callSign: string;
  };
  readonly programs: ReadonlyArray<Record<string, unknown>>;
}>;
export type ItemPlaylistsResult = ReadonlyArray<{
  readonly ratingKey: string;
  readonly title: string;
  readonly leafCount: number;
}>;
export type AddToPlaylistResult = {
  readonly leafCountAdded: number;
};
export type CreatePlaylistResult = {
  readonly ratingKey: string | null;
  readonly title: string;
};
export type UserInfoResult = PlexUserInfo;

/**
 * Assert a wire `unknown` as plex-query `ItemMetadata`.
 * Server already zod-validated via plex-query before encoding.
 */
export const asItemMetadata = (value: unknown): ItemMetadata =>
  value as ItemMetadata;

/**
 * Assert a wire `unknown` as the getItemDetails composite (or null).
 * Server already zod-validated via plex-query before encoding.
 */
export const asItemDetails = (value: unknown): ItemDetails | null =>
  value as ItemDetails | null;

/**
 * Assert a wire `unknown` as plex-query `PlayQueueResponse`.
 * Server already zod-validated via plex-query before encoding.
 */
export const asPlayQueue = (value: unknown): PlayQueueResponse =>
  value as PlayQueueResponse;

/**
 * Assert Effect Schema / wire room objects as plex-query `WatchTogetherRoom`.
 * Field shapes match; Effect's readonly arrays are compatible at runtime.
 */
export const asWatchTogetherRoom = (value: unknown): WatchTogetherRoom =>
  value as WatchTogetherRoom;

export const asWatchTogetherRooms = (value: unknown): WatchTogetherRoom[] =>
  value as WatchTogetherRoom[];

export const asHomeHubs = (value: unknown): HomeHubsResult =>
  value as HomeHubsResult;

export const asContinueWatching = (value: unknown): ContinueWatchingResult =>
  value as ContinueWatchingResult;

export const asServerLibraries = (value: unknown): ServerLibrariesResult =>
  value as ServerLibrariesResult;

export const asLibraryHubs = (value: unknown): LibraryHubsResult =>
  value as LibraryHubsResult;

export const asLibraryPivots = (value: unknown): LibraryPivotsResult =>
  value as LibraryPivotsResult;

export const asLibraryMeta = (value: unknown): LibraryMetaResult =>
  value as LibraryMetaResult;

export const asLibraryContentPage = (value: unknown): LibraryContentPage =>
  value as LibraryContentPage;

export const asLibraryCollectionsPage = (
  value: unknown,
): LibraryCollectionsPage => value as LibraryCollectionsPage;

export const asLibraryPlaylistsPage = (value: unknown): LibraryPlaylistsPage =>
  value as LibraryPlaylistsPage;

export const asLibraryCategories = (value: unknown): LibraryCategoriesResult =>
  value as LibraryCategoriesResult;

export const asLibraryFilterValues = (
  value: unknown,
): LibraryFilterValuesResult => value as LibraryFilterValuesResult;

export const asHubContentPage = (value: unknown): HubContentPage =>
  value as HubContentPage;

export const asSearchResults = (value: unknown): SearchResults =>
  value as SearchResults;

export const asLiveTvProgramming = (value: unknown): LiveTvProgrammingResult =>
  value as LiveTvProgrammingResult;

export const asItemPlaylists = (value: unknown): ItemPlaylistsResult =>
  value as ItemPlaylistsResult;

export const asUserInfo = (value: unknown): UserInfoResult =>
  value as UserInfoResult;

export const asAddToPlaylistResult = (value: unknown): AddToPlaylistResult =>
  value as AddToPlaylistResult;

export const asCreatePlaylistResult = (value: unknown): CreatePlaylistResult =>
  value as CreatePlaylistResult;

/** Stable serialization for AtomHttpApi `serializationKey` / family keys. */
export const stableRecordKey = (
  record: Record<string, string> | undefined,
): string => {
  if (!record) return "";
  return Object.entries(record)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
};

export type { PlaylistType };
