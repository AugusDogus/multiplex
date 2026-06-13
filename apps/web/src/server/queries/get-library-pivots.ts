import type { LibrarySectionPivots, PlexTvClient } from "@multiplex/plex-query";
import { withPlexServerContext } from "~/server/queries/plex-server-context";

const EMPTY_PIVOTS: LibrarySectionPivots = { title: undefined, pivots: [] };

/**
 * Pivots (tabs) Plex exposes through `/media/providers` for a section, in
 * Plex's order (Recommended, Library, Collections, Categories), plus the
 * section title. A synthetic `playlists` pivot is appended when the section has
 * any playlists, since the media providers payload omits playlists.
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
      const [{ title, pivots }, playlists] = await Promise.all([
        context.serverClient.getLibraryPivots(sectionId),
        context.serverClient
          .getPlaylists(sectionId, { start: 0, size: 1 })
          .catch(() => null),
      ]);

      if (pivots.length === 0) {
        return EMPTY_PIVOTS;
      }

      if (playlists && playlists.totalSize > 0) {
        return {
          title,
          pivots: [
            ...pivots,
            {
              id: "playlists",
              type: "list",
              key: `/playlists?sectionID=${sectionId}`,
              title: "Playlists",
              symbol: "playlist",
            },
          ],
        };
      }

      return { title, pivots };
    },
  );
}
