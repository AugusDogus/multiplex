import {
  filterNonEmptyHubs,
  type HubWithServer,
  type PlexTvClient,
} from "@multiplex/plex-query";
import {
  enrichHubsWithServer,
  resolvePlexServerContext,
  withPmsRetry,
} from "~/server/queries/plex-server-context";

export async function getLibraryHubsQuery(
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
