import {
  filterNonEmptyHubs,
  type HubWithServer,
  type PlexTvClient,
} from "@multiplex/plex-query";
import {
  enrichHubsWithServer,
  withPlexServerContext,
} from "~/server/queries/plex-server-context";

export async function getLibraryHubsQuery(
  plex: PlexTvClient,
  machineIdentifier: string,
  sectionId: string,
): Promise<HubWithServer[]> {
  return withPlexServerContext(plex, machineIdentifier, [], async (context) => {
    const response = await context.serverClient.getSectionHubs(sectionId, {
      onlyTransient: true,
    });

    return enrichHubsWithServer(filterNonEmptyHubs(response.hubs), context);
  });
}
