import {
  filterBrowsableHubs,
  type HubWithServer,
  type PlexTvClient,
} from "@multiplex/plex-query";
import {
  enrichHubsWithServer,
  resolvePlexServerContext,
} from "~/server/queries/plex-server-context";

export async function getLibraryHubsQuery(
  plex: PlexTvClient,
  machineIdentifier: string,
  sectionId: string,
): Promise<HubWithServer[]> {
  try {
    const context = await resolvePlexServerContext(plex, machineIdentifier);

    if (!context) {
      return [];
    }

    const response = await context.serverClient.getSectionHubs(sectionId, {
      onlyTransient: true,
    });

    return enrichHubsWithServer(filterBrowsableHubs(response.hubs), context);
  } catch {
    return [];
  }
}
