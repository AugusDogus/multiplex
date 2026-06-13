import type { PlexTvClient } from "@multiplex/plex-query";
import { LIBRARY_PAGE_SIZE } from "~/server/queries/plex-pagination";
import {
  EMPTY_PAGINATED_HUB_CONTENT,
  enrichHubItemsWithServer,
  resolvePlexServerContext,
  type PaginatedHubContent,
} from "~/server/queries/plex-server-context";

export async function getLibraryPlaylistsQuery(
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

    const response = await context.serverClient.getPlaylists(sectionId, {
      start: options?.start ?? 0,
      size: options?.size ?? LIBRARY_PAGE_SIZE,
    });

    // Playlists expose their poster under `composite`; surface it as `thumb`
    // so the shared poster card renders an image.
    const items = response.items.map((item) => ({
      ...item,
      thumb: item.thumb ?? item.composite,
    }));

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
