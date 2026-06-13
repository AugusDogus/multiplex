import type { LibraryMetaResponse, PlexTvClient } from "@multiplex/plex-query";
import { withPlexServerContext } from "~/server/queries/plex-server-context";

const EMPTY_LIBRARY_META: LibraryMetaResponse = {
  librarySectionID: undefined,
  librarySectionTitle: undefined,
  types: [],
};

/**
 * Filter/sort metadata for the Library tab dropdown menus. `type` selects
 * which content pivot's filters and sorts to surface (e.g. shows vs. episodes).
 */
export async function getLibraryMetaQuery(
  plex: PlexTvClient,
  machineIdentifier: string,
  sectionId: string,
  type?: string,
): Promise<LibraryMetaResponse> {
  return withPlexServerContext(
    plex,
    machineIdentifier,
    EMPTY_LIBRARY_META,
    (context) => context.serverClient.getLibraryMeta(sectionId, type),
  );
}
