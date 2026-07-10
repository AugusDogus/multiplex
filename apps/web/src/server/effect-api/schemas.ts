import { Effect, Schema } from "effect";
import {
  HUB_PAGE_SIZE,
  LIBRARY_PAGE_SIZE,
  playlistTypes,
} from "@multiplex/plex-query";

// ---------------------------------------------------------------------------
// Input validators — mirror apps/web/src/server/api/routers/plex.ts zod schemas
// ---------------------------------------------------------------------------

export const SectionId = Schema.String.check(Schema.isPattern(/^\d+$/));

export const WatchTogetherRoomId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9]+$/),
);

export const MetadataRatingKey = Schema.String.check(Schema.isPattern(/^\d+$/));

export const MetadataKey = Schema.String.check(
  Schema.isPattern(/^\/library\/metadata\/\d+$/),
);

export const FilterPath = Schema.String.check(
  Schema.isPattern(/^\/library\/sections\/\d+\/[A-Za-z]+(\?.*)?$/),
);

export const IsoDateString = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
);

export const PlaylistType = Schema.Literals(playlistTypes);

export const SearchType = Schema.Literals([
  "movies",
  "tv",
  "music",
  "people",
] as const);

export const TimelineState = Schema.Literals([
  "playing",
  "paused",
  "buffering",
  "stopped",
] as const);

export const PinAction = Schema.Literals(["pin", "unpin"] as const);

export const PlayQueueMediaType = Schema.Literals(["video", "audio"] as const);

const defaultNumber = (value: number) =>
  Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

const defaultBoolean = (value: boolean) =>
  Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

const defaultString = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

// ---------------------------------------------------------------------------
// Precise domain shapes (Watch Together + invitees + servers + user info)
// ---------------------------------------------------------------------------

/**
 * Mirrors `watchTogetherUserSchema` (zod passthrough) field-for-field.
 * Extra Plex fields are retained via the record rest schema.
 */
export const WatchTogetherUser = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.Number,
    title: Schema.optional(Schema.NullOr(Schema.String)),
    username: Schema.optional(Schema.NullOr(Schema.String)),
    thumb: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

/**
 * Mirrors `watchTogetherRoomSchema` (zod passthrough) field-for-field.
 * Extra Plex fields are retained via the record rest schema.
 */
export const WatchTogetherRoom = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.String,
    sourceUri: Schema.String,
    source: Schema.optionalKey(Schema.String),
    title: Schema.String,
    type: Schema.String,
    startsAt: Schema.optionalKey(Schema.Number),
    endsAt: Schema.optionalKey(Schema.Number),
    updatedAt: Schema.optionalKey(Schema.Number),
    syncplayHost: Schema.String,
    syncplayPort: Schema.Number,
    users: Schema.Array(WatchTogetherUser).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

/** Mapped invitee shape from `getWatchTogetherInvitees` (not the raw friend). */
export const WatchTogetherInvitee = Schema.Struct({
  id: Schema.Number,
  uuid: Schema.String,
  title: Schema.String,
  username: Schema.String,
  thumb: Schema.NullishOr(Schema.String),
  restricted: Schema.Boolean,
});

/** Mirrors `deviceSchema` / what `getServers` returns per entry. */
export const PlexServer = Schema.Struct({
  name: Schema.String,
  product: Schema.String,
  productVersion: Schema.String,
  platform: Schema.String,
  platformVersion: Schema.String,
  device: Schema.String,
  clientIdentifier: Schema.String,
  createdAt: Schema.String,
  lastSeenAt: Schema.String,
  provides: Schema.String,
  ownerId: Schema.NullOr(Schema.Number),
  sourceTitle: Schema.NullOr(Schema.String),
  publicAddress: Schema.String,
  accessToken: Schema.NullOr(Schema.String),
  owned: Schema.Boolean,
  home: Schema.Boolean,
  synced: Schema.Boolean,
  relay: Schema.Boolean,
  presence: Schema.Boolean,
  httpsRequired: Schema.Boolean,
  publicAddressMatches: Schema.Boolean,
  dnsRebindingProtection: Schema.optional(Schema.NullOr(Schema.Boolean)),
  natLoopbackSupported: Schema.optional(Schema.NullOr(Schema.Boolean)),
  connections: Schema.Array(
    Schema.Struct({
      protocol: Schema.String,
      address: Schema.String,
      port: Schema.Number,
      uri: Schema.String,
      local: Schema.Boolean,
      relay: Schema.Boolean,
      IPv6: Schema.Boolean,
    }),
  ),
});

/**
 * Precise-enough user info boundary: core identity fields are typed; the
 * remainder of the large plex-query `userInfoSchema` tree (settings,
 * subscription features, etc.) is retained as open keys. plex-query already
 * zod-validates this server-side.
 */
export const UserInfo = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.Number,
    uuid: Schema.String,
    username: Schema.String,
    title: Schema.String,
    email: Schema.String,
    friendlyName: Schema.String,
    thumb: Schema.String,
    authToken: Schema.String,
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

/** Sidebar pin source — mirrors `pinnedSourceSchema` core fields + passthrough. */
export const PinnedSource = Schema.StructWithRest(
  Schema.Struct({
    key: Schema.String,
    sourceType: Schema.String,
    machineIdentifier: Schema.String,
    providerIdentifier: Schema.String,
    directoryID: Schema.String,
    title: Schema.String,
    serverFriendlyName: Schema.String,
    serverSourceTitle: Schema.optionalKey(Schema.NullishOr(Schema.String)),
    providerSourceTitle: Schema.optionalKey(Schema.NullishOr(Schema.String)),
    directoryIcon: Schema.optionalKey(Schema.String),
    isCloud: Schema.optionalKey(Schema.Boolean),
    isFullOwnedServer: Schema.Boolean,
    hiddenAt: Schema.optionalKey(Schema.NullishOr(Schema.String)),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

export const PlaylistSummary = Schema.Struct({
  ratingKey: Schema.String,
  title: Schema.String,
  leafCount: Schema.Number,
});

export const AddToPlaylistResult = Schema.Struct({
  leafCountAdded: Schema.Number,
});

export const CreatePlaylistResult = Schema.Struct({
  ratingKey: Schema.NullOr(Schema.String),
  title: Schema.String,
});

// ---------------------------------------------------------------------------
// Permissive boundary schemas for large Plex metadata trees
//
// Tradeoff: plex-query already zod-validates these server-side. Hand-porting
// the entire metadata schema library would be brittle and huge. The HttpApi
// wire contract accepts `unknown` here; a typed client-side boundary helper
// (Phase 5-2) re-asserts the plex-query types. Tighten opportunistically.
// ---------------------------------------------------------------------------

/** Item metadata / MediaContainer trees from Plex server APIs. */
export const PlexMetadataUnknown = Schema.Unknown;

/** Play queue payloads (`createPlayQueue` / `getPlayQueue` / `updatePlayQueue`). */
export const PlayQueueUnknown = Schema.Unknown;

/** Home / library hub MediaContainers. */
export const HubsUnknown = Schema.Unknown;

/** Library section content / collections / categories / playlists / pivots / meta. */
export const LibraryContentUnknown = Schema.Unknown;

/** Continue Watching aggregates and per-server rows. */
export const ContinueWatchingUnknown = Schema.Unknown;

/** Global search result trees. */
export const SearchResultsUnknown = Schema.Unknown;

/** Live TV channel programming trees. */
export const LiveTvUnknown = Schema.Unknown;

/**
 * Object-shaped library directory list (`getAllServerLibraries`).
 * Guaranteed to be an object/array from plex-query; kept open for nested media.
 */
export const ServerLibrariesUnknown = Schema.Unknown;

/** Item details composite (`item` + children + play target + server connection). */
export const ItemDetailsUnknown = Schema.NullOr(Schema.Unknown);

// ---------------------------------------------------------------------------
// Endpoint input shapes
// ---------------------------------------------------------------------------

export const RoomIdParams = { roomId: WatchTogetherRoomId };

export const CreateWatchTogetherRoomBody = Schema.Struct({
  serverId: Schema.String,
  ratingKey: MetadataRatingKey,
  key: Schema.optionalKey(MetadataKey),
  title: Schema.String.check(Schema.isMinLength(1)),
  users: Schema.Array(Schema.Number).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});

export const InviteWatchTogetherUsersBody = Schema.Struct({
  users: Schema.Array(Schema.Number).check(Schema.isMinLength(1)),
});

export const TogglePinnedSourceBody = Schema.Struct({
  action: PinAction,
  source: PinnedSource,
});

export const LibrarySectionQuery = Schema.Struct({
  machineIdentifier: Schema.String,
  sectionId: SectionId,
});

export const LibraryMetaQuery = Schema.Struct({
  machineIdentifier: Schema.String,
  sectionId: SectionId,
  type: Schema.optionalKey(Schema.String),
});

export const LibraryPageQuery = Schema.Struct({
  machineIdentifier: Schema.String,
  sectionId: SectionId,
  start: defaultNumber(0),
  size: defaultNumber(LIBRARY_PAGE_SIZE),
});

export const LibraryCategoriesQuery = Schema.Struct({
  machineIdentifier: Schema.String,
  sectionId: SectionId,
  start: defaultNumber(0),
  size: defaultNumber(200),
});

export const LibraryFilterValuesQuery = Schema.Struct({
  machineIdentifier: Schema.String,
  filterPath: FilterPath,
});

export const HubContentQuery = Schema.Struct({
  machineIdentifier: Schema.String,
  hubKey: Schema.String.check(Schema.isMinLength(1)),
  start: defaultNumber(0),
  size: defaultNumber(HUB_PAGE_SIZE),
});

/** Complex filters → POST body (query string cannot encode a string record). */
export const LibraryContentBody = Schema.Struct({
  machineIdentifier: Schema.String,
  sectionId: SectionId,
  start: defaultNumber(0),
  size: defaultNumber(LIBRARY_PAGE_SIZE),
  sort: defaultString("addedAt:desc"),
  type: Schema.optionalKey(Schema.String),
  filters: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

export const ContinueWatchingQuery = Schema.Struct({
  serverId: Schema.String,
  contentDirectoryIds: Schema.Array(Schema.String),
});

export const SearchQuery = Schema.Struct({
  query: Schema.String.check(Schema.isMinLength(1)),
  limit: defaultNumber(100),
  searchTypes: Schema.Array(SearchType).pipe(
    Schema.withDecodingDefault(
      Effect.succeed(["movies", "music", "people", "tv"] as const),
    ),
  ),
  includeCollections: defaultBoolean(true),
  includeExternalMedia: defaultBoolean(true),
});

export const ChannelsProgrammingBody = Schema.Struct({
  date: IsoDateString,
  startTime: Schema.optionalKey(Schema.DateFromString),
  endTime: Schema.optionalKey(Schema.DateFromString),
});

export const ServerChannelsProgrammingBody = Schema.Struct({
  machineIdentifier: Schema.String,
  providerIdentifier: Schema.String,
  date: IsoDateString,
  startTime: Schema.optionalKey(Schema.DateFromString),
  endTime: Schema.optionalKey(Schema.DateFromString),
});

export const SendTimelineBody = Schema.Struct({
  serverId: Schema.String,
  ratingKey: Schema.String,
  key: Schema.String,
  playQueueItemID: Schema.optionalKey(Schema.String),
  playbackTime: Schema.Number,
  time: Schema.Number,
  duration: Schema.Number,
  state: TimelineState,
  hasMDE: Schema.optionalKey(Schema.Number),
  context: Schema.optionalKey(Schema.String),
  sessionId: Schema.String,
});

export const CreatePlayQueueBody = Schema.Struct({
  serverId: Schema.String,
  type: PlayQueueMediaType,
  uri: Schema.String,
  continuous: defaultBoolean(true),
  includeMarkers: defaultBoolean(true),
  includeChapters: defaultBoolean(true),
  shuffle: defaultBoolean(false),
  repeat: defaultNumber(0),
});

export const GetPlayQueueQuery = Schema.Struct({
  serverId: Schema.String,
  playQueueId: Schema.String,
  includeMarkers: defaultBoolean(true),
});

export const SetItemWatchedStateBody = Schema.Struct({
  serverId: Schema.String,
  ratingKey: Schema.String,
  watched: Schema.Boolean,
  serverUrl: Schema.optionalKey(Schema.String),
  authToken: Schema.optionalKey(Schema.String),
});

export const UpdatePlayQueueBody = Schema.Struct({
  serverId: Schema.String,
  serverUrl: Schema.String,
  authToken: Schema.String,
  playQueueId: Schema.String,
  ratingKey: Schema.String,
  key: Schema.String,
  type: PlayQueueMediaType.pipe(
    Schema.withDecodingDefault(Effect.succeed("video" as const)),
  ),
  next: Schema.optionalKey(Schema.Boolean),
});

export const GetItemPlaylistsQuery = Schema.Struct({
  serverId: Schema.String,
  serverUrl: Schema.String,
  authToken: Schema.String,
  playlistType: PlaylistType,
});

export const AddItemToPlaylistBody = Schema.Struct({
  serverId: Schema.String,
  serverUrl: Schema.String,
  authToken: Schema.String,
  playlistRatingKey: Schema.String,
  playlistTitle: Schema.optionalKey(Schema.String),
  ratingKey: Schema.String,
  key: Schema.String,
});

export const CreatePlaylistWithItemBody = Schema.Struct({
  serverId: Schema.String,
  serverUrl: Schema.String,
  authToken: Schema.String,
  title: Schema.String.check(Schema.isMinLength(1)).check(
    Schema.isMaxLength(255),
  ),
  type: PlaylistType,
  ratingKey: Schema.String,
  key: Schema.String,
});

export const ServerItemQuery = Schema.Struct({
  serverId: Schema.String,
  ratingKey: Schema.String,
});
