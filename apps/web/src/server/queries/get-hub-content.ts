import type { PlexTvClient } from "@multiplex/plex-query";
import { HUB_PAGE_SIZE } from "~/server/queries/plex-pagination";
import {
  EMPTY_PAGINATED_HUB_CONTENT,
  enrichHubItemsWithServer,
  withPlexServerContext,
  type PaginatedHubContent,
} from "~/server/queries/plex-server-context";

export async function getHubContentQuery(
  plex: PlexTvClient,
  machineIdentifier: string,
  hubKey: string,
  options?: { start?: number; size?: number },
): Promise<PaginatedHubContent> {
  return withPlexServerContext(
    plex,
    machineIdentifier,
    EMPTY_PAGINATED_HUB_CONTENT,
    async (context) => {
      const response = await context.serverClient.getHubContent(hubKey, {
        start: options?.start ?? 0,
        size: options?.size ?? HUB_PAGE_SIZE,
      });

      return {
        items: enrichHubItemsWithServer(response.items, context),
        totalSize: response.totalSize,
        offset: response.offset,
      };
    },
  );
}
