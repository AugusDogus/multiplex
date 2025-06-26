import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { posts } from "~/server/db/schema";
import { getAllContinueWatchingQuery } from "~/server/queries/get-all-continue-watching";
import { getAllServerLibrariesQuery } from "~/server/queries/get-all-server-libraries";
import { getContinueWatchingQuery } from "~/server/queries/get-continue-watching";
import { getServerLibrariesQuery } from "~/server/queries/get-server-libraries";
import { getServersQuery } from "~/server/queries/get-servers";
import { getUserInfoQuery } from "~/server/queries/get-user-info";

export type plexRouterInputs = inferRouterInputs<typeof plexRouter>;
export type plexRouterOutputs = inferRouterOutputs<typeof plexRouter>;

export const plexRouter = createTRPCRouter({
  hello: publicProcedure
    .input(z.object({ text: z.string() }))
    .query(({ input }) => {
      return {
        greeting: `Hello ${input.text}`,
      };
    }),

  create: publicProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.insert(posts).values({
        name: input.name,
      });
    }),

  getLatest: publicProcedure.query(async ({ ctx }) => {
    const post = await ctx.db.query.posts.findFirst({
      orderBy: (posts, { desc }) => [desc(posts.createdAt)],
    });

    return post ?? null;
  }),

  getServers: protectedProcedure.query(async ({ ctx }) => {
    return getServersQuery(ctx.plex);
  }),

  getUserInfo: protectedProcedure.query(async ({ ctx }) => {
    return getUserInfoQuery(ctx.plex);
  }),

  getServerLibraries: protectedProcedure
    .input(z.object({ serverId: z.string() }))
    .query(async ({ ctx, input }) => {
      return getServerLibrariesQuery(ctx.plex, input.serverId);
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
