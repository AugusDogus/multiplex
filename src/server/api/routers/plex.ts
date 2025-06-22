import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { posts } from "~/server/db/schema";

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
    const servers = await ctx.plex.getServers();
    return servers;
  }),

  getUserInfo: protectedProcedure.query(async ({ ctx }) => {
    const userInfo = await ctx.plex.getUserInfo();
    return userInfo;
  }),

  getServerLibraries: protectedProcedure
    .input(z.object({ serverId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Get servers and find the one we want
      const servers = await ctx.plex.getServers();
      const server = servers.find((s) => s.clientIdentifier === input.serverId);

      if (!server) {
        throw new Error(`Server not found: ${input.serverId}`);
      }

      // Create server client and get media providers
      const serverClient = ctx.plex.createServerClient(server);
      const mediaProviders = await serverClient.getMediaProviders();

      return mediaProviders;
    }),

  getAllServerLibraries: protectedProcedure.query(async ({ ctx }) => {
    const servers = await ctx.plex.getServers();

    // Fetch library data for all servers in parallel
    const serverLibrariesPromises = servers.map(async (server) => {
      try {
        const serverClient = ctx.plex.createServerClient(server);
        const mediaProviders = await serverClient.getMediaProviders();

        return {
          serverId: server.clientIdentifier,
          serverName: server.name,
          mediaProviders,
          error: undefined,
        };
      } catch (error) {
        return {
          serverId: server.clientIdentifier,
          serverName: server.name,
          mediaProviders: undefined,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    });

    // Use Promise.allSettled to handle failures gracefully
    const settledResults = await Promise.allSettled(serverLibrariesPromises);

    // Extract results, handling both fulfilled and rejected promises
    const results = settledResults.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        // Handle rejected promises (network errors, timeouts, etc.)
        const server = servers[index]!;
        return {
          serverId: server.clientIdentifier,
          serverName: server.name,
          mediaProviders: undefined,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : "Server connection failed",
        };
      }
    });

    return results;
  }),
});
