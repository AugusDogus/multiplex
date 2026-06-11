import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import {
  getServerUrl,
  getNextPinnedSources,
  pinnedSourceSchema,
  enrichMetadataChildren,
  getPlayableChildren,
  resolvePlayTarget,
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
import { getLibraryContentQuery } from "~/server/queries/get-library-content";
import { getLibraryHubsQuery } from "~/server/queries/get-library-hubs";
import { getServersQuery } from "~/server/queries/get-servers";
import { getUserInfoQuery } from "~/server/queries/get-user-info";
import { searchQuery } from "~/server/queries/search";

export type plexRouterInputs = inferRouterInputs<typeof plexRouter>;
export type plexRouterOutputs = inferRouterOutputs<typeof plexRouter>;

export const plexRouter = createTRPCRouter({
  getServers: protectedProcedure.query(async ({ ctx }) => {
    return getServersQuery(ctx.plex);
  }),

  getUserInfo: protectedProcedure.query(async ({ ctx }) => {
    return getUserInfoQuery(ctx.plex);
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
      const userInfo = await getUserInfoQuery(ctx.plex);
      const currentPinnedSources =
        userInfo.settings?.sidebarSettings?.pinnedSources ?? [];
      const nextPinnedSources = getNextPinnedSources(
        currentPinnedSources,
        input.source,
        input.action,
      );

      await ctx.plex.updateSidebarPinnedSources(nextPinnedSources);

      // Bypass the request-cached query to return fresh post-mutation settings.
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
        sectionId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return getLibraryHubsQuery(
        ctx.plex,
        input.machineIdentifier,
        input.sectionId,
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
        sectionId: z.string(),
        start: z.number().int().min(0).default(0),
        size: z
          .number()
          .int()
          .min(1)
          .max(LIBRARY_PAGE_SIZE)
          .default(LIBRARY_PAGE_SIZE),
        sort: z.string().default("addedAt:desc"),
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
      const servers = await getServersQuery(ctx.plex);
      const server = servers.find((s) => s.clientIdentifier === input.serverId);

      if (!server) {
        throw new Error(`Server with ID ${input.serverId} not found`);
      }

      const serverClient = ctx.plex.createServerClient(server);

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
        uri: z.string(),
        continuous: z.boolean().default(true),
        includeMarkers: z.boolean().default(true),
        includeChapters: z.boolean().default(true),
        shuffle: z.boolean().default(false),
        repeat: z.number().default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const servers = await getServersQuery(ctx.plex);
      const server = servers.find((s) => s.clientIdentifier === input.serverId);

      if (!server) {
        throw new Error(`Server with ID ${input.serverId} not found`);
      }

      const serverClient = ctx.plex.createServerClient(server);
      return await serverClient.createPlayQueue({
        type: input.type,
        uri: input.uri,
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
      const servers = await getServersQuery(ctx.plex);
      const server = servers.find((s) => s.clientIdentifier === input.serverId);

      if (!server) {
        throw new Error(`Server with ID ${input.serverId} not found`);
      }

      const serverClient = ctx.plex.createServerClient(server);
      return await serverClient.getPlayQueue(
        input.playQueueId,
        input.includeMarkers,
      );
    }),

  getItemMetadata: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        ratingKey: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const servers = await getServersQuery(ctx.plex);
      const server = servers.find((s) => s.clientIdentifier === input.serverId);

      if (!server) {
        throw new Error(`Server with ID ${input.serverId} not found`);
      }

      const serverClient = ctx.plex.createServerClient(server);
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
      const servers = await getServersQuery(ctx.plex);
      const server = servers.find((s) => s.clientIdentifier === input.serverId);

      if (!server) {
        throw new Error(`Server with ID ${input.serverId} not found`);
      }

      const serverClient = ctx.plex.createServerClient(server);
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
