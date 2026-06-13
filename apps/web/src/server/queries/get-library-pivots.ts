import type { LibraryPivot, PlexTvClient } from "@multiplex/plex-query";
import { resolvePlexServerContext } from "~/server/queries/plex-server-context";

/**
 * Pivots (tabs) Plex exposes through `/media/providers` for a section, in
 * Plex's order (Recommended, Library, Collections, Categories). A synthetic
 * `playlists` pivot is appended when the section has any playlists, since the
 * media providers payload omits playlists.
 */
export async function getLibraryPivotsQuery(
  plex: PlexTvClient,
  machineIdentifier: string,
  sectionId: string,
): Promise<LibraryPivot[]> {
  try {
    const context = await resolvePlexServerContext(plex, machineIdentifier);

    if (!context) {
      return [];
    }

    const [pivots, playlists] = await Promise.all([
      context.serverClient.getLibraryPivots(sectionId),
      context.serverClient
        .getPlaylists(sectionId, { start: 0, size: 1 })
        .catch(() => null),
    ]);

    if (pivots.length === 0) {
      return [];
    }

    if (playlists && playlists.totalSize > 0) {
      return [
        ...pivots,
        {
          id: "playlists",
          type: "list",
          key: `/playlists?sectionID=${sectionId}`,
          title: "Playlists",
          symbol: "playlist",
        },
      ];
    }

    return pivots;
  } catch {
    return [];
  }
}
