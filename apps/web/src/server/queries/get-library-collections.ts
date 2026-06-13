import type { PlexTvClient } from "@multiplex/plex-query";
import { LIBRARY_PAGE_SIZE } from "~/server/queries/plex-pagination";
import {
  EMPTY_PAGINATED_HUB_CONTENT,
  enrichHubItemsWithServer,
  resolvePlexServerContext,
  type PaginatedHubContent,
} from "~/server/queries/plex-server-context";

export async function getLibraryCollectionsQuery(
  plex: PlexTvClient,
  machineIdentifier: string,
  sectionId: string,
  options?: { start?: number; size?: number },
): Promise<PaginatedHubContent> {
  try {
    const context = await resolvePlexServerContext(plex, machineIdentifier);

    if (!context) {
      return EMPTY_PAGINATED_HUB_CONTENT;
    }

    const response = await context.serverClient.getCollections(sectionId, {
      start: options?.start ?? 0,
      size: options?.size ?? LIBRARY_PAGE_SIZE,
    });

    // Empty collections have no composite poster; drop the thumb so the card
    // renders its placeholder instead of attempting a broken image request.
    const items = response.items.map((item) =>
      item.childCount === 0 ? { ...item, thumb: undefined } : item,
    );

    return {
      items: enrichHubItemsWithServer(items, context),
      totalSize: response.totalSize,
      offset: response.offset,
      librarySectionTitle: response.librarySectionTitle,
    };
  } catch {
    return EMPTY_PAGINATED_HUB_CONTENT;
  }
}
