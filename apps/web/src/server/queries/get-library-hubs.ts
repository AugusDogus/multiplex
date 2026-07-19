import { cacheLife } from "next/cache";
import { cache } from "react";
import {
  filterNonEmptyHubs,
  PlexTvClient,
  type HubWithServer,
} from "@multiplex/plex-query";
import { NEXTJS_PLEX_CONFIG } from "~/lib/plex-config";
import {
  enrichHubsWithServer,
  resolvePlexServerContext,
  withPmsRetry,
} from "~/server/queries/plex-server-context";

async function fetchLibraryHubs(
  token: string,
  machineIdentifier: string,
  sectionId: string,
): Promise<HubWithServer[]> {
  "use cache";
  cacheLife("seconds");

  const plex = new PlexTvClient(token, NEXTJS_PLEX_CONFIG);
  return loadLibraryHubs(plex, machineIdentifier, sectionId);
}

async function loadLibraryHubs(
  plex: PlexTvClient,
  machineIdentifier: string,
  sectionId: string,
): Promise<HubWithServer[]> {
  const resolved = await resolvePlexServerContext(plex, machineIdentifier);

  if (!resolved) {
    return [];
  }

  return withPmsRetry(
    plex,
    resolved.server,
    resolved.userInfo,
    async (context) => {
      const response = await context.serverClient.getSectionHubs(sectionId, {
        onlyTransient: true,
      });

      return enrichHubsWithServer(filterNonEmptyHubs(response.hubs), context);
    },
  );
}

export const getLibraryHubsQuery = cache(
  async (
    plex: PlexTvClient,
    machineIdentifier: string,
    sectionId: string,
  ): Promise<HubWithServer[]> => {
    return fetchLibraryHubs(plex.getToken(), machineIdentifier, sectionId);
  },
);
