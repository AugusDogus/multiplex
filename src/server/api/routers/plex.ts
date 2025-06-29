import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getAllContinueWatchingQuery } from "~/server/queries/get-all-continue-watching";
import { getAllServerLibrariesQuery } from "~/server/queries/get-all-server-libraries";
import { getContinueWatchingQuery } from "~/server/queries/get-continue-watching";
import { getServersQuery } from "~/server/queries/get-servers";
import { getUserInfoQuery } from "~/server/queries/get-user-info";

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
});
