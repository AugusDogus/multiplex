import { cacheLife } from "next/cache";
import { cache } from "react";
import { PlexTvClient, type LibrarySectionPivots } from "@multiplex/plex-query";
import { NEXTJS_PLEX_CONFIG } from "~/lib/plex-config";
import { withPlexServerContext } from "~/server/queries/plex-server-context";

const EMPTY_PIVOTS: LibrarySectionPivots = { title: undefined, pivots: [] };

async function fetchLibraryPivots(
  token: string,
  machineIdentifier: string,
  sectionId: string,
): Promise<LibrarySectionPivots> {
  "use cache";
  cacheLife("minutes");

  const plex = new PlexTvClient(token, NEXTJS_PLEX_CONFIG);
  return loadLibraryPivots(plex, machineIdentifier, sectionId);
}

async function loadLibraryPivots(
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

/**
 * Pivots (tabs) Plex exposes through `/media/providers` for a section, in
 * Plex's order (e.g. Recommended, Library, Collections, Categories, Playlists),
 * plus the section title.
 */
export const getLibraryPivotsQuery = cache(
  async (
    plex: PlexTvClient,
    machineIdentifier: string,
    sectionId: string,
  ): Promise<LibrarySectionPivots> => {
    return fetchLibraryPivots(plex.getToken(), machineIdentifier, sectionId);
  },
);
