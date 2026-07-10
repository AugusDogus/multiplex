import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  OpenApi,
} from "effect/unstable/httpapi";
import { Schema } from "effect";
import { HttpApiSchema } from "effect/unstable/httpapi";

import { PlexAuthMiddleware } from "./auth-middleware";
import {
  InternalPlexError,
  NotFoundError,
  PlexRequestError,
  UnauthorizedError,
} from "./errors";
import * as S from "./schemas";

const AuthErrors = [UnauthorizedError] as const;
const PlexErrors = [
  UnauthorizedError,
  PlexRequestError,
  InternalPlexError,
  NotFoundError,
] as const;

const EmptySuccess = HttpApiSchema.Empty(200);

const WatchTogetherApi = HttpApiGroup.make("watchTogether")
  .add(
    HttpApiEndpoint.get("getWatchTogetherRooms", "/watch-together/rooms", {
      success: Schema.Array(S.WatchTogetherRoom),
      error: [...AuthErrors, PlexRequestError, InternalPlexError],
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "getWatchTogetherRoom",
      "/watch-together/rooms/:roomId",
      {
        params: S.RoomIdParams,
        success: S.WatchTogetherRoom,
        error: [
          ...AuthErrors,
          PlexRequestError,
          InternalPlexError,
          NotFoundError,
        ],
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("createWatchTogetherRoom", "/watch-together/rooms", {
      payload: S.CreateWatchTogetherRoomBody,
      success: S.WatchTogetherRoom,
      error: [...AuthErrors, PlexRequestError, InternalPlexError],
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "inviteWatchTogetherUsers",
      "/watch-together/rooms/:roomId/invite",
      {
        params: S.RoomIdParams,
        payload: S.InviteWatchTogetherUsersBody,
        success: EmptySuccess,
        error: [...AuthErrors, PlexRequestError, InternalPlexError],
      },
    ),
  )
  .add(
    HttpApiEndpoint.delete(
      "deleteWatchTogetherRoom",
      "/watch-together/rooms/:roomId",
      {
        params: S.RoomIdParams,
        success: EmptySuccess,
        error: [...AuthErrors, PlexRequestError, InternalPlexError],
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "getWatchTogetherInvitees",
      "/watch-together/invitees",
      {
        success: Schema.Array(S.WatchTogetherInvitee),
        error: [...AuthErrors, PlexRequestError, InternalPlexError],
      },
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "Watch Together" }))
  .middleware(PlexAuthMiddleware);

const AccountApi = HttpApiGroup.make("account")
  .add(
    HttpApiEndpoint.get("getServers", "/account/servers", {
      success: Schema.Array(S.PlexServer),
      error: [...AuthErrors, PlexRequestError, InternalPlexError],
    }),
  )
  .add(
    HttpApiEndpoint.get("getUserInfo", "/account/user-info", {
      success: S.UserInfo,
      error: [...AuthErrors, PlexRequestError, InternalPlexError],
    }),
  )
  .add(
    HttpApiEndpoint.post("togglePinnedSource", "/account/pinned-sources", {
      payload: S.TogglePinnedSourceBody,
      success: S.UserInfo,
      error: [...AuthErrors, PlexRequestError, InternalPlexError],
    }),
  )
  .annotateMerge(OpenApi.annotations({ title: "Account" }))
  .middleware(PlexAuthMiddleware);

const LibraryApi = HttpApiGroup.make("library")
  .add(
    HttpApiEndpoint.get("getAllServerLibraries", "/library/servers", {
      success: S.ServerLibrariesUnknown,
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.get("getHomeHubs", "/library/home-hubs", {
      success: S.HubsUnknown,
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "getAllContinueWatching",
      "/library/continue-watching",
      {
        success: S.ContinueWatchingUnknown,
        error: [...PlexErrors],
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "getContinueWatching",
      "/library/continue-watching/server",
      {
        query: S.ContinueWatchingQuery,
        success: S.ContinueWatchingUnknown,
        error: [...PlexErrors],
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("getLibraryHubs", "/library/hubs", {
      query: S.LibrarySectionQuery,
      success: S.HubsUnknown,
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.get("getLibraryPivots", "/library/pivots", {
      query: S.LibrarySectionQuery,
      success: S.LibraryContentUnknown,
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.get("getLibraryMeta", "/library/meta", {
      query: S.LibraryMetaQuery,
      success: S.LibraryContentUnknown,
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.get("getLibraryCollections", "/library/collections", {
      query: S.LibraryPageQuery,
      success: S.LibraryContentUnknown,
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.get("getLibraryCategories", "/library/categories", {
      query: S.LibraryCategoriesQuery,
      success: S.LibraryContentUnknown,
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.get("getLibraryPlaylists", "/library/playlists", {
      query: S.LibraryPageQuery,
      success: S.LibraryContentUnknown,
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.get("getLibraryFilterValues", "/library/filter-values", {
      query: S.LibraryFilterValuesQuery,
      success: S.LibraryContentUnknown,
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.get("getHubContent", "/library/hub-content", {
      query: S.HubContentQuery,
      success: S.LibraryContentUnknown,
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.post("getLibraryContent", "/library/content", {
      payload: S.LibraryContentBody,
      success: S.LibraryContentUnknown,
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.get("getItemMetadata", "/library/item-metadata", {
      query: S.ServerItemQuery,
      success: S.PlexMetadataUnknown,
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.get("getItemDetails", "/library/item-details", {
      query: S.ServerItemQuery,
      success: S.ItemDetailsUnknown,
      error: [...PlexErrors],
    }),
  )
  .annotateMerge(OpenApi.annotations({ title: "Library" }))
  .middleware(PlexAuthMiddleware);

const PlaybackApi = HttpApiGroup.make("playback")
  .add(
    HttpApiEndpoint.post("sendTimeline", "/playback/timeline", {
      payload: S.SendTimelineBody,
      success: EmptySuccess,
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.post("createPlayQueue", "/playback/play-queues", {
      payload: S.CreatePlayQueueBody,
      success: S.PlayQueueUnknown,
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.get("getPlayQueue", "/playback/play-queues", {
      query: S.GetPlayQueueQuery,
      success: S.PlayQueueUnknown,
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.post("updatePlayQueue", "/playback/play-queues/update", {
      payload: S.UpdatePlayQueueBody,
      success: S.PlayQueueUnknown,
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.post("setItemWatchedState", "/playback/watched-state", {
      payload: S.SetItemWatchedStateBody,
      success: EmptySuccess,
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.get("getItemPlaylists", "/playback/item-playlists", {
      query: S.GetItemPlaylistsQuery,
      success: Schema.Array(S.PlaylistSummary),
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.post("addItemToPlaylist", "/playback/playlists/items", {
      payload: S.AddItemToPlaylistBody,
      success: S.AddToPlaylistResult,
      error: [...PlexErrors],
    }),
  )
  .add(
    HttpApiEndpoint.post("createPlaylistWithItem", "/playback/playlists", {
      payload: S.CreatePlaylistWithItemBody,
      success: S.CreatePlaylistResult,
      error: [...PlexErrors],
    }),
  )
  .annotateMerge(OpenApi.annotations({ title: "Playback" }))
  .middleware(PlexAuthMiddleware);

const SearchApi = HttpApiGroup.make("search")
  .add(
    HttpApiEndpoint.get("search", "/search", {
      query: S.SearchQuery,
      success: S.SearchResultsUnknown,
      error: [...PlexErrors],
    }),
  )
  .annotateMerge(OpenApi.annotations({ title: "Search" }))
  .middleware(PlexAuthMiddleware);

const LiveTvApi = HttpApiGroup.make("liveTv")
  .add(
    HttpApiEndpoint.post(
      "getAllChannelsProgramming",
      "/live-tv/channels-programming",
      {
        payload: S.ChannelsProgrammingBody,
        success: S.LiveTvUnknown,
        error: [...PlexErrors],
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "getServerChannelsProgramming",
      "/live-tv/server-channels-programming",
      {
        payload: S.ServerChannelsProgrammingBody,
        success: S.LiveTvUnknown,
        error: [...PlexErrors],
      },
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "Live TV" }))
  .middleware(PlexAuthMiddleware);

/**
 * Plex domain HttpApi — additive mirror of the tRPC `plex` router.
 * Mounted at `/api/effect` beside tRPC; clients are unchanged until P5-2.
 */
export const PlexApi = HttpApi.make("plex")
  .add(WatchTogetherApi)
  .add(AccountApi)
  .add(LibraryApi)
  .add(PlaybackApi)
  .add(SearchApi)
  .add(LiveTvApi)
  .annotateMerge(
    OpenApi.annotations({
      title: "Multiplex Plex API",
      description:
        "Effect HttpApi surface mirroring the plex tRPC router (additive migration).",
    }),
  );
