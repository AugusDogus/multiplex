import {
  TRPCError,
  type inferRouterInputs,
  type inferRouterOutputs,
} from "@trpc/server";
import {
  getServerUrl,
  getPlexConfig,
  getNextPinnedSources,
  pinnedSourceSchema,
  buildLibraryItemUri,
  enrichMetadataChildren,
  getPlayableChildren,
  playlistTypes,
  resolvePlayTarget,
  type PlexTvClient,
  WatchTogetherClient,
} from "@multiplex/plex-query";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getAllContinueWatchingQuery } from "~/server/queries/get-all-continue-watching";
import { getAllServerLibrariesQuery } from "~/server/queries/get-all-server-libraries";
import { getAllChannelsProgrammingQuery } from "~/server/queries/get-all-channels-programming";
import { getServerChannelsProgrammingQuery } from "~/server/queries/get-all-channels-programming";
import { getContinueWatchingQuery } from "~/server/queries/get-continue-watching";
import {
  HUB_PAGE_SIZE,
  LIBRARY_PAGE_SIZE,
} from "~/server/queries/plex-pagination";
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

export type plexRouterInputs = inferRouterInputs<typeof plexRouter>;
export type plexRouterOutputs = inferRouterOutputs<typeof plexRouter>;

// Plex library section IDs are numeric; constraining them prevents a crafted
// `source` value from injecting extra path segments or query params into the
// `library/sections/{id}/...` requests.
const sectionIdSchema = z.string().regex(/^\d+$/);
const watchTogetherRoomIdSchema = z.string().regex(/^[A-Za-z0-9]+$/);
const metadataRatingKeySchema = z.string().regex(/^\d+$/);
const metadataKeySchema = z
  .string()
  .regex(/^\/library\/metadata\/\d+$/)
  .optional();

const watchTogetherClientForToken = (token: string) =>
  new WatchTogetherClient(token, getPlexConfig());

const resolveServer = async (plex: PlexTvClient, serverId: string) => {
  let servers: Awaited<ReturnType<typeof getServersQuery>>;

  try {
    servers = await getServersQuery(plex);
  } catch (cause) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Unable to load Plex servers",
      cause,
    });
  }

  const server = servers.find(
    (candidate) => candidate.clientIdentifier === serverId,
  );

  if (!server) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Server with ID ${serverId} not found`,
    });
  }

  if (
    !server.presence ||
    !server.connections.some((connection) => connection.uri.trim().length > 0)
  ) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: `Server with ID ${serverId} is unavailable`,
    });
  }

  return {
    server,
    serverClient: plex.createServerClient(server),
  };
};

export const plexRouter = createTRPCRouter({
  getServers: protectedProcedure.query(async ({ ctx }) => {
    return getServersQuery(ctx.plex);
  }),

  getUserInfo: protectedProcedure.query(async ({ ctx }) => {
    return getUserInfoQuery(ctx.plex);
  }),

  getWatchTogetherRooms: protectedProcedure.query(async ({ ctx }) => {
    return watchTogetherClientForToken(ctx.plex.getToken()).listRooms();
  }),

  getWatchTogetherRoom: protectedProcedure
    .input(z.object({ roomId: watchTogetherRoomIdSchema }))
    .query(async ({ ctx, input }) => {
      return watchTogetherClientForToken(ctx.plex.getToken()).getRoom(
        input.roomId,
      );
    }),

  getWatchTogetherInvitees: protectedProcedure.query(async ({ ctx }) => {
    const invitees = await ctx.plex.getWatchTogetherInvitees();
    return invitees.map((invitee) => ({
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
      thumb: invitee.thumb,
      restricted: invitee.restricted ?? false,
    }));
  }),

  createWatchTogetherRoom: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        ratingKey: metadataRatingKeySchema,
        key: metadataKeySchema,
        title: z.string().min(1),
        users: z.array(z.number()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await resolveServer(ctx.plex, input.serverId);

      return watchTogetherClientForToken(ctx.plex.getToken()).createRoom({
        sourceUri: buildLibraryItemUri(
          input.serverId,
          input.ratingKey,
          input.key,
        ),
        title: input.title,
        users: input.users,
      });
    }),

  inviteWatchTogetherUsers: protectedProcedure
    .input(
      z.object({
        roomId: watchTogetherRoomIdSchema,
        users: z.array(z.number()).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await watchTogetherClientForToken(ctx.plex.getToken()).inviteUsers(
        input.roomId,
        input.users,
      );
    }),

  deleteWatchTogetherRoom: protectedProcedure
    .input(z.object({ roomId: watchTogetherRoomIdSchema }))
    .mutation(async ({ ctx, input }) => {
      await watchTogetherClientForToken(ctx.plex.getToken()).deleteRoom(
        input.roomId,
      );
    }),

  getAllServerLibraries: protectedProcedure.query(async ({ ctx }) => {
    return getAllServerLibrariesQuery(ctx.plex);
  }),

  togglePinnedSource: protectedProcedure
    .input(
      z.object({
        action: z.enum(["pin", "unpin"]),
        source: pinnedSourceSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Read-modify-write base must be fresh: the cached query serves stale
      // data (SWR), which would silently drop pins toggled moments earlier.
      const userInfo = await ctx.plex.getUserInfo();
      const currentPinnedSources =
        userInfo.settings?.sidebarSettings?.pinnedSources ?? [];
      const nextPinnedSources = getNextPinnedSources(
        currentPinnedSources,
        input.source,
        input.action,
      );

      await ctx.plex.updateSidebarPinnedSources(nextPinnedSources);

      // Mark the cached user info stale (SWR: one poll may still see the old
      // sources, the next one is fresh) and return fresh post-mutation settings.
      invalidateUserInfoCache(ctx.plex);
      return ctx.plex.getUserInfo();
    }),

  getAllContinueWatching: protectedProcedure.query(async ({ ctx }) => {
    return getAllContinueWatchingQuery(ctx.plex);
  }),

  getHomeHubs: protectedProcedure.query(async ({ ctx }) => {
    return getHomeHubsQuery(ctx.plex);
  }),

  getLibraryHubs: protectedProcedure
    .input(
      z.object({
        machineIdentifier: z.string(),
        sectionId: sectionIdSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      return getLibraryHubsQuery(
        ctx.plex,
        input.machineIdentifier,
        input.sectionId,
      );
    }),

  getLibraryPivots: protectedProcedure
    .input(
      z.object({
        machineIdentifier: z.string(),
        sectionId: sectionIdSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      return getLibraryPivotsQuery(
        ctx.plex,
        input.machineIdentifier,
        input.sectionId,
      );
    }),

  getLibraryMeta: protectedProcedure
    .input(
      z.object({
        machineIdentifier: z.string(),
        sectionId: sectionIdSchema,
        type: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return getLibraryMetaQuery(
        ctx.plex,
        input.machineIdentifier,
        input.sectionId,
        input.type,
      );
    }),

  getLibraryCollections: protectedProcedure
    .input(
      z.object({
        machineIdentifier: z.string(),
        sectionId: sectionIdSchema,
        start: z.number().int().min(0).default(0),
        size: z
          .number()
          .int()
          .min(1)
          .max(LIBRARY_PAGE_SIZE)
          .default(LIBRARY_PAGE_SIZE),
      }),
    )
    .query(async ({ ctx, input }) => {
      return getLibraryCollectionsQuery(
        ctx.plex,
        input.machineIdentifier,
        input.sectionId,
        { start: input.start, size: input.size },
      );
    }),

  getLibraryCategories: protectedProcedure
    .input(
      z.object({
        machineIdentifier: z.string(),
        sectionId: sectionIdSchema,
        start: z.number().int().min(0).default(0),
        size: z.number().int().min(1).max(500).default(200),
      }),
    )
    .query(async ({ ctx, input }) => {
      return getLibraryCategoriesQuery(
        ctx.plex,
        input.machineIdentifier,
        input.sectionId,
        { start: input.start, size: input.size },
      );
    }),

  getLibraryPlaylists: protectedProcedure
    .input(
      z.object({
        machineIdentifier: z.string(),
        sectionId: sectionIdSchema,
        start: z.number().int().min(0).default(0),
        size: z
          .number()
          .int()
          .min(1)
          .max(LIBRARY_PAGE_SIZE)
          .default(LIBRARY_PAGE_SIZE),
      }),
    )
    .query(async ({ ctx, input }) => {
      return getLibraryPlaylistsQuery(
        ctx.plex,
        input.machineIdentifier,
        input.sectionId,
        { start: input.start, size: input.size },
      );
    }),

  getLibraryFilterValues: protectedProcedure
    .input(
      z.object({
        machineIdentifier: z.string(),
        // The filter's `key` from library metadata, restricted to the
        // library-section filter endpoints to avoid arbitrary fan-out.
        filterPath: z
          .string()
          .regex(/^\/library\/sections\/\d+\/[A-Za-z]+(\?.*)?$/),
      }),
    )
    .query(async ({ ctx, input }) => {
      return getLibraryFilterValuesQuery(
        ctx.plex,
        input.machineIdentifier,
        input.filterPath,
      );
    }),

  getHubContent: protectedProcedure
    .input(
      z.object({
        machineIdentifier: z.string(),
        hubKey: z.string().min(1),
        start: z.number().int().min(0).default(0),
        size: z.number().int().min(1).max(HUB_PAGE_SIZE).default(HUB_PAGE_SIZE),
      }),
    )
    .query(async ({ ctx, input }) => {
      return getHubContentQuery(
        ctx.plex,
        input.machineIdentifier,
        input.hubKey,
        {
          start: input.start,
          size: input.size,
        },
      );
    }),

  getLibraryContent: protectedProcedure
    .input(
      z.object({
        machineIdentifier: z.string(),
        sectionId: sectionIdSchema,
        start: z.number().int().min(0).default(0),
        size: z
          .number()
          .int()
          .min(1)
          .max(LIBRARY_PAGE_SIZE)
          .default(LIBRARY_PAGE_SIZE),
        sort: z.string().default("addedAt:desc"),
        type: z.string().optional(),
        filters: z.record(z.string(), z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return getLibraryContentQuery(
        ctx.plex,
        input.machineIdentifier,
        input.sectionId,
        {
          start: input.start,
          size: input.size,
          sort: input.sort,
          type: input.type,
          filters: input.filters,
        },
      );
    }),

  getContinueWatching: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        contentDirectoryIds: z.array(z.string()),
      }),
    )
    .query(async ({ ctx, input }) => {
      return getContinueWatchingQuery(
        ctx.plex,
        input.serverId,
        input.contentDirectoryIds,
      );
    }),

  search: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1),
        limit: z.number().default(100),
        searchTypes: z
          .array(z.enum(["movies", "tv", "music", "people"]))
          .default(["movies", "music", "people", "tv"]),
        includeCollections: z.boolean().default(true),
        includeExternalMedia: z.boolean().default(true),
      }),
    )
    .query(async ({ ctx, input }) => {
      return searchQuery(ctx.plex, input);
    }),

  getAllChannelsProgramming: protectedProcedure
    .input(
      z.object({
        date: z.string().date(),
        startTime: z.date().optional(),
        endTime: z.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return getAllChannelsProgrammingQuery(
        ctx.plex,
        input.date,
        input.startTime,
        input.endTime,
      );
    }),

  getServerChannelsProgramming: protectedProcedure
    .input(
      z.object({
        machineIdentifier: z.string(),
        providerIdentifier: z.string(),
        date: z.string().date(),
        startTime: z.date().optional(),
        endTime: z.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return getServerChannelsProgrammingQuery(
        ctx.plex,
        input.machineIdentifier,
        input.providerIdentifier,
        input.date,
        input.startTime,
        input.endTime,
      );
    }),

  sendTimeline: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        ratingKey: z.string(),
        key: z.string(),
        playQueueItemID: z.string().optional(),
        playbackTime: z.number(),
        time: z.number(),
        duration: z.number(),
        state: z.enum(["playing", "paused", "buffering", "stopped"]),
        hasMDE: z.number().optional(),
        context: z.string().optional(),
        sessionId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { serverClient } = await resolveServer(ctx.plex, input.serverId);

      await serverClient.sendTimeline({
        ratingKey: input.ratingKey,
        key: input.key,
        playQueueItemID: input.playQueueItemID,
        playbackTime: input.playbackTime,
        time: input.time,
        duration: input.duration,
        state: input.state,
        hasMDE: input.hasMDE,
        context: input.context,
        sessionId: input.sessionId,
      });
    }),

  createPlayQueue: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        type: z.enum(["video", "audio"]),
        ratingKey: metadataRatingKeySchema,
        key: metadataKeySchema,
        continuous: z.boolean().default(true),
        includeMarkers: z.boolean().default(true),
        includeChapters: z.boolean().default(true),
        shuffle: z.boolean().default(false),
        repeat: z.number().default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { serverClient } = await resolveServer(ctx.plex, input.serverId);
      return await serverClient.createPlayQueue({
        type: input.type,
        uri: buildLibraryItemUri(input.serverId, input.ratingKey, input.key),
        continuous: input.continuous,
        includeMarkers: input.includeMarkers,
        includeChapters: input.includeChapters,
        shuffle: input.shuffle,
        repeat: input.repeat,
      });
    }),

  getPlayQueue: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        playQueueId: z.string(),
        includeMarkers: z.boolean().default(true),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { serverClient } = await resolveServer(ctx.plex, input.serverId);
      return await serverClient.getPlayQueue(
        input.playQueueId,
        input.includeMarkers,
      );
    }),

  setItemWatchedState: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        ratingKey: z.string(),
        watched: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { serverClient } = await resolveServer(ctx.plex, input.serverId);

      if (input.watched) {
        await serverClient.markItemWatched(input.ratingKey);
      } else {
        await serverClient.markItemUnwatched(input.ratingKey);
      }

      void ctx.plex.syncViewState().catch((error: unknown) => {
        console.error("Failed to sync Plex view state", error);
      });
    }),

  updatePlayQueue: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        playQueueId: z.string(),
        ratingKey: z.string(),
        key: z.string(),
        type: z.enum(["video", "audio"]).default("video"),
        next: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { serverClient } = await resolveServer(ctx.plex, input.serverId);

      return await serverClient.updatePlayQueue({
        playQueueId: input.playQueueId,
        type: input.type,
        uri: buildLibraryItemUri(input.serverId, input.ratingKey, input.key),
        next: input.next,
      });
    }),

  getItemPlaylists: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        playlistType: z.enum(playlistTypes),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { serverClient } = await resolveServer(ctx.plex, input.serverId);

      const playlists = await serverClient.getPlaylistsByType(
        input.playlistType,
      );

      // Smart playlists are rule-driven, so Plex rejects manual appends; hide
      // them from the picker to match Plex Web.
      return playlists
        .filter((playlist) => !playlist.smart)
        .map((playlist) => ({
          ratingKey: playlist.ratingKey,
          title: playlist.title,
          leafCount: playlist.leafCount ?? 0,
        }));
    }),

  addItemToPlaylist: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        playlistRatingKey: z.string(),
        // Carried through only so the client can show "Added to <name>"; the
        // server identifies the playlist by `playlistRatingKey`.
        playlistTitle: z.string().optional(),
        ratingKey: z.string(),
        key: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { serverClient } = await resolveServer(ctx.plex, input.serverId);

      const response = await serverClient.addItemToPlaylist(
        input.playlistRatingKey,
        buildLibraryItemUri(input.serverId, input.ratingKey, input.key),
      );

      return { leafCountAdded: response.MediaContainer.leafCountAdded ?? 0 };
    }),

  createPlaylistWithItem: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        title: z.string().trim().min(1).max(255),
        type: z.enum(playlistTypes),
        ratingKey: z.string(),
        key: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { serverClient } = await resolveServer(ctx.plex, input.serverId);

      const response = await serverClient.createPlaylist({
        title: input.title,
        type: input.type,
        uri: buildLibraryItemUri(input.serverId, input.ratingKey, input.key),
      });

      return {
        ratingKey: response.MediaContainer.Metadata?.[0]?.ratingKey ?? null,
        title: response.MediaContainer.Metadata?.[0]?.title ?? input.title,
      };
    }),

  getItemMetadata: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        ratingKey: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { serverClient } = await resolveServer(ctx.plex, input.serverId);
      return await serverClient.getItemMetadata(input.ratingKey);
    }),

  getItemDetails: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        ratingKey: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { server, serverClient } = await resolveServer(
        ctx.plex,
        input.serverId,
      );
      const item = await serverClient.getItemMetadata(input.ratingKey);

      if (!item) {
        return null;
      }

      const children =
        item.type === "show" || item.type === "season"
          ? enrichMetadataChildren(
              await serverClient.getMetadataChildren(input.ratingKey),
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
        authToken: server.accessToken ?? ctx.authSession.user.plexAuthToken,
      };
    }),
});
