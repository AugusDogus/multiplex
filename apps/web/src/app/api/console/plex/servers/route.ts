import { PlexTvClient } from "@multiplex/plex-query";

import { NEXTJS_PLEX_CONFIG } from "~/lib/plex-config";
import {
  authenticateConsoleDevice,
  parseConsoleDeviceAuthorization,
} from "~/server/console-pairing";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
} as const;

export async function GET(request: Request): Promise<Response> {
  const credential = parseConsoleDeviceAuthorization(
    request.headers.get("authorization"),
  );
  if (!credential) return unauthorized();
  const authenticated = await authenticateConsoleDevice(credential);
  if (!authenticated) return unauthorized();
  if (!authenticated.user.plexAuthToken) {
    return Response.json(
      { status: "plex-not-linked", servers: [] },
      { status: 409, headers: RESPONSE_HEADERS },
    );
  }

  const plex = new PlexTvClient(
    authenticated.user.plexAuthToken,
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
