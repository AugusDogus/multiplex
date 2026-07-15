import { TRPCError } from "@trpc/server";
import type { PlexTvClient } from "@multiplex/plex-query";

import { getServersQuery } from "~/server/queries/get-servers";

export async function resolveServer(plex: PlexTvClient, serverId: string) {
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
}
