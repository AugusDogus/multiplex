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

    // A 0-item collection's composite poster (`/library/collections/{id}/
    // composite/...`) renders nothing, so drop it to show a clean placeholder
    // instead of a broken image. Smart collections with a real metadata poster
    // (e.g. AniList tiles) keep their artwork even when currently empty.
    const items = response.items.map((item) =>
      item.childCount === 0 && item.thumb?.includes("/composite/")
        ? { ...item, thumb: undefined }
        : item,
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
