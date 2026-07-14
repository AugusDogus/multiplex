import type { HubItemWithServer, PlexTvClient } from "@multiplex/plex-query";
import { LIBRARY_PAGE_SIZE } from "~/server/queries/plex-pagination";
import {
  EMPTY_PAGINATED_HUB_CONTENT,
  enrichHubItemsWithServer,
  withPlexServerContext,
  type PaginatedHubContent,
} from "~/server/queries/plex-server-context";

export function preservePlaylistSectionContext(
  items: HubItemWithServer[],
  librarySectionID: number,
): HubItemWithServer[] {
  return items.map((item) => ({
    ...item,
    librarySectionID,
  }));
}

export async function getLibraryPlaylistsQuery(
  plex: PlexTvClient,
  machineIdentifier: string,
  sectionId: string,
  options?: { start?: number; size?: number },
): Promise<PaginatedHubContent> {
  const librarySectionID = Number(sectionId);
  if (!Number.isSafeInteger(librarySectionID) || librarySectionID <= 0) {
    return EMPTY_PAGINATED_HUB_CONTENT;
  }

  return withPlexServerContext(
    plex,
    machineIdentifier,
    EMPTY_PAGINATED_HUB_CONTENT,
    async (context) => {
      const response = await context.serverClient.getPlaylists(sectionId, {
        start: options?.start ?? 0,
        size: options?.size ?? LIBRARY_PAGE_SIZE,
      });

      return {
        items: preservePlaylistSectionContext(
          enrichHubItemsWithServer(response.items, context),
          librarySectionID,
        ),
        totalSize: response.totalSize,
        offset: response.offset,
        librarySectionTitle: response.librarySectionTitle,
      };
    },
  );
}
