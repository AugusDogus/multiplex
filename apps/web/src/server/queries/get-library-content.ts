import type { PlexTvClient } from "@multiplex/plex-query";
import { LIBRARY_PAGE_SIZE } from "~/server/queries/plex-pagination";
import {
  EMPTY_PAGINATED_HUB_CONTENT,
  enrichHubItemsWithServer,
  withPlexServerContext,
  type PaginatedHubContent,
} from "~/server/queries/plex-server-context";

export async function getLibraryContentQuery(
  plex: PlexTvClient,
  machineIdentifier: string,
  sectionId: string,
  options?: {
    start?: number;
    size?: number;
    sort?: string;
    type?: string;
    filters?: Record<string, string>;
  },
): Promise<PaginatedHubContent> {
  return withPlexServerContext(
    plex,
    machineIdentifier,
    EMPTY_PAGINATED_HUB_CONTENT,
    async (context) => {
      const response = await context.serverClient.getLibraryContent(sectionId, {
        start: options?.start ?? 0,
        size: options?.size ?? LIBRARY_PAGE_SIZE,
        sort: options?.sort ?? "addedAt:desc",
        type: options?.type,
        filters: options?.filters,
      });

      return {
        items: enrichHubItemsWithServer(response.items, context),
        totalSize: response.totalSize,
        offset: response.offset,
        librarySectionTitle: response.librarySectionTitle,
      };
    },
  );
}
