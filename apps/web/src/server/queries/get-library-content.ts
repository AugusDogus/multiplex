import type { PlexTvClient } from "@multiplex/plex-query";
import { LIBRARY_PAGE_SIZE } from "~/server/queries/plex-pagination";
import {
  EMPTY_PAGINATED_HUB_CONTENT,
  enrichHubItemsWithServer,
  resolvePlexServerContext,
  type PaginatedHubContent,
} from "~/server/queries/plex-server-context";

export async function getLibraryContentQuery(
  plex: PlexTvClient,
  machineIdentifier: string,
  sectionId: string,
  options?: { start?: number; size?: number; sort?: string },
): Promise<PaginatedHubContent> {
  try {
    const context = await resolvePlexServerContext(plex, machineIdentifier);

    if (!context) {
      return EMPTY_PAGINATED_HUB_CONTENT;
    }

    const response = await context.serverClient.getLibraryContent(sectionId, {
      start: options?.start ?? 0,
      size: options?.size ?? LIBRARY_PAGE_SIZE,
      sort: options?.sort ?? "addedAt:desc",
    });

    return {
      items: enrichHubItemsWithServer(response.items, context),
      totalSize: response.totalSize,
      offset: response.offset,
      librarySectionTitle: response.librarySectionTitle,
    };
  } catch {
    return EMPTY_PAGINATED_HUB_CONTENT;
  }
}
