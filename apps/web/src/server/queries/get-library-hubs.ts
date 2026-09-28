import {
  filterNonEmptyHubs,
  type PlexTvClient,
  type HubWithServer,
} from "@multiplex/plex-query";
import {
  enrichHubsWithServer,
  resolvePlexServerContext,
  withPmsRetry,
} from "~/server/queries/plex-server-context";

// TanStack DB caches these snapshots. Server reads must stay fresh: Next's
// cross-request cache can join a pre-mutation fill even after tag expiration.
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
