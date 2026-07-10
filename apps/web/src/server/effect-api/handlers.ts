import {
  buildLibraryItemUri,
  enrichMetadataChildren,
  getNextPinnedSources,
  getPlayableChildren,
  getPlexConfig,
  getServerUrl,
  PlexServerClient,
  resolvePlayTarget,
} from "@multiplex/plex-query";
import { Effect, Layer, Option, Schema } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { getAllChannelsProgrammingQuery } from "~/server/queries/get-all-channels-programming";
import { getAllContinueWatchingQuery } from "~/server/queries/get-all-continue-watching";
import { getAllServerLibrariesQuery } from "~/server/queries/get-all-server-libraries";
import { getServerChannelsProgrammingQuery } from "~/server/queries/get-all-channels-programming";
import { getContinueWatchingQuery } from "~/server/queries/get-continue-watching";
import { getHomeHubsQuery } from "~/server/queries/get-home-hubs";
import { getHubContentQuery } from "~/server/queries/get-hub-content";
import { getLibraryCategoriesQuery } from "~/server/queries/get-library-categories";
import { getLibraryCollectionsQuery } from "~/server/queries/get-library-collections";
import { getLibraryContentQuery } from "~/server/queries/get-library-content";
import { getLibraryFilterValuesQuery } from "~/server/queries/get-library-filter-values";
import { getLibraryHubsQuery } from "~/server/queries/get-library-hubs";
import { getLibraryMetaQuery } from "~/server/queries/get-library-meta";
import { getLibraryPivotsQuery } from "~/server/queries/get-library-pivots";
import { getLibraryPlaylistsQuery } from "~/server/queries/get-library-playlists";
import { getServersQuery } from "~/server/queries/get-servers";
import {
  getUserInfoQuery,
  invalidateUserInfoCache,
} from "~/server/queries/get-user-info";
import { searchQuery } from "~/server/queries/search";

import { PlexApi } from "./api";
import { findServer, PlexSession } from "./auth-middleware";
import { NotFoundError, PlexRequestError } from "./errors";
import {
  PlexServer,
  UserInfo,
  WatchTogetherInvitee,
  WatchTogetherRoom,
} from "./schemas";

const plexTry = <A>(
  operation: string,
  tryFn: () => Promise<A>,
): Effect.Effect<A, PlexRequestError> =>
  Effect.tryPromise({
    try: tryFn,
    catch: () =>
      new PlexRequestError({
        operation,
        message: "Plex request failed",
      }),
  });

/**
 * Decode a plex-query (zod) value into the HttpApi Effect Schema type.
 * Uses sync `decodeUnknownOption` so `DecodingServices` stay out of the
 * handler R channel (these schemas are service-free).
 */
const decodeAs =
  <A>(schema: Schema.Decoder<A, never>, operation: string) =>
  (value: unknown): Effect.Effect<A, PlexRequestError> => {
    const decoded = Schema.decodeUnknownOption(schema)(value);
    if (Option.isNone(decoded)) {
      return Effect.fail(
        new PlexRequestError({
          operation,
          message: "Failed to encode response",
        }),
      );
    }
    return Effect.succeed(decoded.value);
  };

const requireServer = (
  servers: Awaited<ReturnType<typeof getServersQuery>>,
  serverId: string,
) => {
  const server = findServer(servers, serverId);
  if (!server) {
    return Effect.fail(
      new NotFoundError({ message: `Server with ID ${serverId} not found` }),
    );
  }
  return Effect.succeed(server);
};

export const WatchTogetherHandlers = HttpApiBuilder.group(
  PlexApi,
  "watchTogether",
  (handlers) =>
    handlers
      .handle("getWatchTogetherRooms", () =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          const rooms = yield* plexTry("getWatchTogetherRooms", () =>
            session.watchTogether.listRooms(),
          );
          return yield* decodeAs(
            Schema.Array(WatchTogetherRoom),
            "getWatchTogetherRooms",
          )(rooms);
        }),
      )
      .handle("getWatchTogetherRoom", ({ params }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          const room = yield* plexTry("getWatchTogetherRoom", () =>
            session.watchTogether.getRoom(params.roomId),
          );
          return yield* decodeAs(
            WatchTogetherRoom,
            "getWatchTogetherRoom",
          )(room);
        }),
      )
      .handle("createWatchTogetherRoom", ({ payload }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          const room = yield* plexTry("createWatchTogetherRoom", () =>
            session.watchTogether.createRoom({
              sourceUri: buildLibraryItemUri(
                payload.serverId,
                payload.ratingKey,
                payload.key,
              ),
              title: payload.title,
              users: [...payload.users],
            }),
          );
          return yield* decodeAs(
            WatchTogetherRoom,
            "createWatchTogetherRoom",
          )(room);
        }),
      )
      .handle("inviteWatchTogetherUsers", ({ params, payload }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          yield* plexTry("inviteWatchTogetherUsers", () =>
            session.watchTogether.inviteUsers(params.roomId, [
              ...payload.users,
            ]),
          );
        }),
      )
      .handle("deleteWatchTogetherRoom", ({ params }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          yield* plexTry("deleteWatchTogetherRoom", () =>
            session.watchTogether.deleteRoom(params.roomId),
          );
        }),
      )
      .handle("getWatchTogetherInvitees", () =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          const invitees = yield* plexTry("getWatchTogetherInvitees", () =>
            session.plex.getWatchTogetherInvitees(),
          );
          const mapped = invitees.map((invitee) => ({
            id: invitee.id,
            uuid: invitee.uuid,
            title:
              invitee.friendlyName ??
              invitee.title ??
              invitee.username ??
              "Plex user",
            username:
              invitee.username ??
              invitee.title ??
              invitee.friendlyName ??
              "Plex user",
            thumb: invitee.thumb ?? null,
            restricted: invitee.restricted ?? false,
          }));
          return yield* decodeAs(
            Schema.Array(WatchTogetherInvitee),
            "getWatchTogetherInvitees",
          )(mapped);
        }),
      ),
);

export const AccountHandlers = HttpApiBuilder.group(
  PlexApi,
  "account",
  (handlers) =>
    handlers
      .handle("getServers", () =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          const servers = yield* plexTry("getServers", () =>
            getServersQuery(session.plex),
          );
          return yield* decodeAs(
            Schema.Array(PlexServer),
            "getServers",
          )(servers);
        }),
      )
      .handle("getUserInfo", () =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          const userInfo = yield* plexTry("getUserInfo", () =>
            getUserInfoQuery(session.plex),
          );
          return yield* decodeAs(UserInfo, "getUserInfo")(userInfo);
        }),
      )
      .handle("togglePinnedSource", ({ payload }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          const userInfo = yield* plexTry("togglePinnedSource", async () => {
            const current = await session.plex.getUserInfo();
            const currentPinnedSources =
              current.settings?.sidebarSettings?.pinnedSources ?? [];
            const nextPinnedSources = getNextPinnedSources(
              currentPinnedSources,
              payload.source,
              payload.action,
            );
            await session.plex.updateSidebarPinnedSources(nextPinnedSources);
            invalidateUserInfoCache(session.plex);
            return session.plex.getUserInfo();
          });
          return yield* decodeAs(UserInfo, "togglePinnedSource")(userInfo);
        }),
      ),
);

export const LibraryHandlers = HttpApiBuilder.group(
  PlexApi,
  "library",
  (handlers) =>
    handlers
      .handle("getAllServerLibraries", () =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          return yield* plexTry("getAllServerLibraries", () =>
            getAllServerLibrariesQuery(session.plex),
          );
        }),
      )
      .handle("getHomeHubs", () =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          return yield* plexTry("getHomeHubs", () =>
            getHomeHubsQuery(session.plex),
          );
        }),
      )
      .handle("getAllContinueWatching", () =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          return yield* plexTry("getAllContinueWatching", () =>
            getAllContinueWatchingQuery(session.plex),
          );
        }),
      )
      .handle("getContinueWatching", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          return yield* plexTry("getContinueWatching", () =>
            getContinueWatchingQuery(session.plex, query.serverId, [
              ...query.contentDirectoryIds,
            ]),
          );
        }),
      )
      .handle("getLibraryHubs", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          return yield* plexTry("getLibraryHubs", () =>
            getLibraryHubsQuery(
              session.plex,
              query.machineIdentifier,
              query.sectionId,
            ),
          );
        }),
      )
      .handle("getLibraryPivots", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          return yield* plexTry("getLibraryPivots", () =>
            getLibraryPivotsQuery(
              session.plex,
              query.machineIdentifier,
              query.sectionId,
            ),
          );
        }),
      )
      .handle("getLibraryMeta", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          return yield* plexTry("getLibraryMeta", () =>
            getLibraryMetaQuery(
              session.plex,
              query.machineIdentifier,
              query.sectionId,
              query.type,
            ),
          );
        }),
      )
      .handle("getLibraryCollections", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          return yield* plexTry("getLibraryCollections", () =>
            getLibraryCollectionsQuery(
              session.plex,
              query.machineIdentifier,
              query.sectionId,
              { start: query.start, size: query.size },
            ),
          );
        }),
      )
      .handle("getLibraryCategories", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          return yield* plexTry("getLibraryCategories", () =>
            getLibraryCategoriesQuery(
              session.plex,
              query.machineIdentifier,
              query.sectionId,
              { start: query.start, size: query.size },
            ),
          );
        }),
      )
      .handle("getLibraryPlaylists", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          return yield* plexTry("getLibraryPlaylists", () =>
            getLibraryPlaylistsQuery(
              session.plex,
              query.machineIdentifier,
              query.sectionId,
              { start: query.start, size: query.size },
            ),
          );
        }),
      )
      .handle("getLibraryFilterValues", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          return yield* plexTry("getLibraryFilterValues", () =>
            getLibraryFilterValuesQuery(
              session.plex,
              query.machineIdentifier,
              query.filterPath,
            ),
          );
        }),
      )
      .handle("getHubContent", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          return yield* plexTry("getHubContent", () =>
            getHubContentQuery(
              session.plex,
              query.machineIdentifier,
              query.hubKey,
              { start: query.start, size: query.size },
            ),
          );
        }),
      )
      .handle("getLibraryContent", ({ payload }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          return yield* plexTry("getLibraryContent", () =>
            getLibraryContentQuery(
              session.plex,
              payload.machineIdentifier,
              payload.sectionId,
              {
                start: payload.start,
                size: payload.size,
                sort: payload.sort,
                type: payload.type,
                filters: payload.filters,
              },
            ),
          );
        }),
      )
      .handle("getItemMetadata", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          const servers = yield* plexTry("getItemMetadata.servers", () =>
            getServersQuery(session.plex),
          );
          const server = yield* requireServer(servers, query.serverId);
          const serverClient = session.plex.createServerClient(server);
          return yield* plexTry("getItemMetadata", () =>
            serverClient.getItemMetadata(query.ratingKey),
          );
        }),
      )
      .handle("getItemDetails", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          const servers = yield* plexTry("getItemDetails.servers", () =>
            getServersQuery(session.plex),
          );
          const server = yield* requireServer(servers, query.serverId);
          const serverClient = session.plex.createServerClient(server);
          return yield* plexTry("getItemDetails", async () => {
            const item = await serverClient.getItemMetadata(query.ratingKey);
            if (!item) {
              return null;
            }

            const children =
              item.type === "show" || item.type === "season"
                ? enrichMetadataChildren(
                    await serverClient.getMetadataChildren(query.ratingKey),
                    item,
                  )
                : [];
            const playableChildren = getPlayableChildren(children);

            return {
              item,
              children,
              playableChildren,
              playTarget: resolvePlayTarget(item, playableChildren),
              serverName: server.name,
              serverUrl: getServerUrl(server),
              authToken:
                server.accessToken ?? session.authSession.user.plexAuthToken,
            };
          });
        }),
      ),
);

export const PlaybackHandlers = HttpApiBuilder.group(
  PlexApi,
  "playback",
  (handlers) =>
    handlers
      .handle("sendTimeline", ({ payload }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          const servers = yield* plexTry("sendTimeline.servers", () =>
            getServersQuery(session.plex),
          );
          const server = yield* requireServer(servers, payload.serverId);
          const serverClient = session.plex.createServerClient(server);
          yield* plexTry("sendTimeline", () =>
            serverClient.sendTimeline({
              ratingKey: payload.ratingKey,
              key: payload.key,
              playQueueItemID: payload.playQueueItemID,
              playbackTime: payload.playbackTime,
              time: payload.time,
              duration: payload.duration,
              state: payload.state,
              hasMDE: payload.hasMDE,
              context: payload.context,
              sessionId: payload.sessionId,
            }),
          );
        }),
      )
      .handle("createPlayQueue", ({ payload }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          const servers = yield* plexTry("createPlayQueue.servers", () =>
            getServersQuery(session.plex),
          );
          const server = yield* requireServer(servers, payload.serverId);
          const serverClient = session.plex.createServerClient(server);
          return yield* plexTry("createPlayQueue", () =>
            serverClient.createPlayQueue({
              type: payload.type,
              uri: payload.uri,
              continuous: payload.continuous,
              includeMarkers: payload.includeMarkers,
              includeChapters: payload.includeChapters,
              shuffle: payload.shuffle,
              repeat: payload.repeat,
            }),
          );
        }),
      )
      .handle("getPlayQueue", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          const servers = yield* plexTry("getPlayQueue.servers", () =>
            getServersQuery(session.plex),
          );
          const server = yield* requireServer(servers, query.serverId);
          const serverClient = session.plex.createServerClient(server);
          return yield* plexTry("getPlayQueue", () =>
            serverClient.getPlayQueue(query.playQueueId, query.includeMarkers),
          );
        }),
      )
      .handle("updatePlayQueue", ({ payload }) =>
        Effect.gen(function* () {
          const serverClient = PlexServerClient.fromConnectionUri(
            payload.serverId,
            payload.serverUrl,
            payload.authToken,
            getPlexConfig(),
          );
          return yield* plexTry("updatePlayQueue", () =>
            serverClient.updatePlayQueue({
              playQueueId: payload.playQueueId,
              type: payload.type,
              uri: buildLibraryItemUri(
                payload.serverId,
                payload.ratingKey,
                payload.key,
              ),
              next: payload.next,
            }),
          );
        }),
      )
      .handle("setItemWatchedState", ({ payload }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          const serverClient =
            payload.serverUrl && payload.authToken
              ? PlexServerClient.fromConnectionUri(
                  payload.serverId,
                  payload.serverUrl,
                  payload.authToken,
                  getPlexConfig(),
                )
              : yield* Effect.gen(function* () {
                  const servers = yield* plexTry(
                    "setItemWatchedState.servers",
                    () => getServersQuery(session.plex),
                  );
                  const server = yield* requireServer(
                    servers,
                    payload.serverId,
                  );
                  return session.plex.createServerClient(server);
                });

          yield* plexTry("setItemWatchedState", async () => {
            if (payload.watched) {
              await serverClient.markItemWatched(payload.ratingKey);
            } else {
              await serverClient.markItemUnwatched(payload.ratingKey);
            }
            void session.plex.syncViewState().catch((error: unknown) => {
              console.error("Failed to sync Plex view state", error);
            });
          });
        }),
      )
      .handle("getItemPlaylists", ({ query }) =>
        Effect.gen(function* () {
          const serverClient = PlexServerClient.fromConnectionUri(
            query.serverId,
            query.serverUrl,
            query.authToken,
            getPlexConfig(),
          );
          const playlists = yield* plexTry("getItemPlaylists", () =>
            serverClient.getPlaylistsByType(query.playlistType),
          );
          return playlists
            .filter((playlist) => !playlist.smart)
            .map((playlist) => ({
              ratingKey: playlist.ratingKey,
              title: playlist.title,
              leafCount: playlist.leafCount ?? 0,
            }));
        }),
      )
      .handle("addItemToPlaylist", ({ payload }) =>
        Effect.gen(function* () {
          const serverClient = PlexServerClient.fromConnectionUri(
            payload.serverId,
            payload.serverUrl,
            payload.authToken,
            getPlexConfig(),
          );
          const response = yield* plexTry("addItemToPlaylist", () =>
            serverClient.addItemToPlaylist(
              payload.playlistRatingKey,
              buildLibraryItemUri(
                payload.serverId,
                payload.ratingKey,
                payload.key,
              ),
            ),
          );
          return {
            leafCountAdded: response.MediaContainer.leafCountAdded ?? 0,
          };
        }),
      )
      .handle("createPlaylistWithItem", ({ payload }) =>
        Effect.gen(function* () {
          const serverClient = PlexServerClient.fromConnectionUri(
            payload.serverId,
            payload.serverUrl,
            payload.authToken,
            getPlexConfig(),
          );
          const response = yield* plexTry("createPlaylistWithItem", () =>
            serverClient.createPlaylist({
              title: payload.title,
              type: payload.type,
              uri: buildLibraryItemUri(
                payload.serverId,
                payload.ratingKey,
                payload.key,
              ),
            }),
          );
          return {
            ratingKey: response.MediaContainer.Metadata?.[0]?.ratingKey ?? null,
            title:
              response.MediaContainer.Metadata?.[0]?.title ?? payload.title,
          };
        }),
      ),
);

export const SearchHandlers = HttpApiBuilder.group(
  PlexApi,
  "search",
  (handlers) =>
    handlers.handle("search", ({ query }) =>
      Effect.gen(function* () {
        const session = yield* PlexSession;
        return yield* plexTry("search", () =>
          searchQuery(session.plex, {
            query: query.query,
            limit: query.limit,
            searchTypes: [...query.searchTypes],
            includeCollections: query.includeCollections,
            includeExternalMedia: query.includeExternalMedia,
          }),
        );
      }),
    ),
);

export const LiveTvHandlers = HttpApiBuilder.group(
  PlexApi,
  "liveTv",
  (handlers) =>
    handlers
      .handle("getAllChannelsProgramming", ({ payload }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          return yield* plexTry("getAllChannelsProgramming", () =>
            getAllChannelsProgrammingQuery(
              session.plex,
              payload.date,
              payload.startTime,
              payload.endTime,
            ),
          );
        }),
      )
      .handle("getServerChannelsProgramming", ({ payload }) =>
        Effect.gen(function* () {
          const session = yield* PlexSession;
          return yield* plexTry("getServerChannelsProgramming", () =>
            getServerChannelsProgrammingQuery(
              session.plex,
              payload.machineIdentifier,
              payload.providerIdentifier,
              payload.date,
              payload.startTime,
              payload.endTime,
            ),
          );
        }),
      ),
);

export const PlexApiHandlers = Layer.mergeAll(
  WatchTogetherHandlers,
  AccountHandlers,
  LibraryHandlers,
  PlaybackHandlers,
  SearchHandlers,
  LiveTvHandlers,
);
