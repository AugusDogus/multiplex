import type { FilterValue, PlexTvClient } from "@multiplex/plex-query";
import { withPlexServerContext } from "~/server/queries/plex-server-context";

/**
 * Possible values for a tag-based library filter (e.g. the genres available
 * for the Genre filter). `filterPath` is the filter's `key` from the library
 * metadata, e.g. `/library/sections/4/genre?type=2`.
 */
export async function getLibraryFilterValuesQuery(
  plex: PlexTvClient,
  machineIdentifier: string,
  filterPath: string,
): Promise<FilterValue[]> {
  return withPlexServerContext(plex, machineIdentifier, [], async (context) => {
    const response = await context.serverClient.getFilterValues(filterPath);
    return response.values;
  });
}
