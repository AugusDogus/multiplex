import type { LibrarySectionPivots, PlexTvClient } from "@multiplex/plex-query";
import { withPlexServerContext } from "~/server/queries/plex-server-context";

const EMPTY_PIVOTS: LibrarySectionPivots = { title: undefined, pivots: [] };

/**
 * Pivots (tabs) Plex exposes through `/media/providers` for a section, in
 * Plex's order (e.g. Recommended, Library, Collections, Categories, Playlists),
 * plus the section title.
 */
export async function getLibraryPivotsQuery(
  plex: PlexTvClient,
  machineIdentifier: string,
  sectionId: string,
): Promise<LibrarySectionPivots> {
  return withPlexServerContext(
    plex,
    machineIdentifier,
    EMPTY_PIVOTS,
    async (context) => {
      const { title, pivots } =
        await context.serverClient.getLibraryPivots(sectionId);

      if (pivots.length === 0) {
        return EMPTY_PIVOTS;
      }

      return { title, pivots };
    },
  );
}
