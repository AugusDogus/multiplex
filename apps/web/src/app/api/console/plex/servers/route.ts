import { PlexTvClient } from "@multiplex/plex-query";

import { NEXTJS_PLEX_CONFIG } from "~/lib/plex-config";
import { authorizeConsolePlexRequest } from "~/server/console-plex-auth";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
} as const;

export async function GET(request: Request): Promise<Response> {
  const authorization = await authorizeConsolePlexRequest(request);
  if (authorization.kind === "unauthorized") return unauthorized();
  if (authorization.kind === "plex-not-linked") {
    return Response.json(
      { status: "plex-not-linked", servers: [] },
      { status: 409, headers: RESPONSE_HEADERS },
    );
  }

  const plex = new PlexTvClient(
    authorization.plexAuthToken,
    NEXTJS_PLEX_CONFIG,
  );
  const servers = await plex.getServers();
  return Response.json(
    {
      apiVersion: 1,
      status: "ready",
      servers: servers.map((server) => ({
        id: server.clientIdentifier,
        name: server.name,
        owned: server.owned,
        presence: server.presence,
        relay: server.relay,
      })),
    },
    { headers: RESPONSE_HEADERS },
  );
}

function unauthorized(): Response {
  return Response.json(
    { status: "invalid-credential" },
    { status: 401, headers: RESPONSE_HEADERS },
  );
}
