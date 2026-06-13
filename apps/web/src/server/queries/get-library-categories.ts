import type { CategoryWithServer, PlexTvClient } from "@multiplex/plex-query";
import { LIBRARY_PAGE_SIZE } from "~/server/queries/plex-pagination";
import { resolvePlexServerContext } from "~/server/queries/plex-server-context";

export interface PaginatedCategories {
  categories: CategoryWithServer[];
  totalSize: number;
  offset: number;
}

const EMPTY_CATEGORIES: PaginatedCategories = {
  categories: [],
  totalSize: 0,
  offset: 0,
};

export async function getLibraryCategoriesQuery(
  plex: PlexTvClient,
  machineIdentifier: string,
  sectionId: string,
  options?: { start?: number; size?: number },
): Promise<PaginatedCategories> {
  try {
    const context = await resolvePlexServerContext(plex, machineIdentifier);

    if (!context) {
      return EMPTY_CATEGORIES;
    }

    const response = await context.serverClient.getCategories(sectionId, {
      start: options?.start ?? 0,
      size: options?.size ?? LIBRARY_PAGE_SIZE,
    });

    return {
      categories: response.categories.map((category) => ({
        ...category,
        serverId: context.server.clientIdentifier,
        serverUrl: context.serverUrl,
        authToken: context.authToken,
      })),
      totalSize: response.totalSize,
      offset: response.offset,
    };
  } catch {
    return EMPTY_CATEGORIES;
  }
}
