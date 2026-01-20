import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getAllContinueWatchingQuery } from "~/server/queries/get-all-continue-watching";
import { getAllServerLibrariesQuery } from "~/server/queries/get-all-server-libraries";
import { getAllChannelsProgrammingQuery } from "~/server/queries/get-all-channels-programming";
import { getServerChannelsProgrammingQuery } from "~/server/queries/get-all-channels-programming";
import { getContinueWatchingQuery } from "~/server/queries/get-continue-watching";
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

  getAllContinueWatching: protectedProcedure.query(async ({ ctx }) => {
    return getAllContinueWatchingQuery(ctx.plex);
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
});
