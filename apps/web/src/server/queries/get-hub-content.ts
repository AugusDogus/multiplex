import type { PlexTvClient } from "@multiplex/plex-query";
import { HUB_PAGE_SIZE } from "~/server/queries/plex-pagination";
import {
  EMPTY_PAGINATED_HUB_CONTENT,
  enrichHubItemsWithServer,
  resolvePlexServerContext,
  type PaginatedHubContent,
} from "~/server/queries/plex-server-context";

export async function getHubContentQuery(
  plex: PlexTvClient,
  machineIdentifier: string,
  hubKey: string,
  options?: { start?: number; size?: number },
): Promise<PaginatedHubContent> {
  try {
    const context = await resolvePlexServerContext(plex, machineIdentifier);

    if (!context) {
      return EMPTY_PAGINATED_HUB_CONTENT;
    }

    const response = await context.serverClient.getHubContent(hubKey, {
      start: options?.start ?? 0,
      size: options?.size ?? HUB_PAGE_SIZE,
    });

    return {
      items: enrichHubItemsWithServer(response.items, context),
      totalSize: response.totalSize,
      offset: response.offset,
    };
  } catch {
    return EMPTY_PAGINATED_HUB_CONTENT;
  }
}
