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
});
