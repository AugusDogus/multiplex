"use client";

import { useCallback } from "react";
import { MediaPosterGrid } from "~/components/media-poster-grid";
import {
  fetchLibraryCollectionsPage,
  fetchLibraryPlaylistsPage,
} from "~/lib/effect/plex-browse-atoms";
import type { LibraryContentPage } from "~/lib/effect/plex-boundary";
import { LIBRARY_PAGE_SIZE } from "~/server/queries/plex-pagination";

type PosterTabKind = "collections" | "playlists";

const EMPTY_MESSAGES: Record<PosterTabKind, string> = {
  collections: "No collections in this library.",
  playlists: "No playlists in this library.",
};

interface LibraryPosterTabProps {
  kind: PosterTabKind;
  machineIdentifier: string;
  sectionId: string;
  initialContent: LibraryContentPage;
}

/**
 * Paginated poster grid for the Collections and Playlists tabs, which share an
 * identical shape and differ only in which page helper loads further pages.
 */
export function LibraryPosterTab({
  kind,
  machineIdentifier,
  sectionId,
  initialContent,
}: LibraryPosterTabProps) {
  const onLoadPage = useCallback(
    (input: { start: number; size: number }) => {
      const fetchPage =
        kind === "collections"
          ? fetchLibraryCollectionsPage
          : fetchLibraryPlaylistsPage;
      return fetchPage({
        machineIdentifier,
        sectionId,
        start: input.start,
        size: input.size,
      });
    },
    [kind, machineIdentifier, sectionId],
  );

  const contentKey = `${machineIdentifier}-${sectionId}-${kind}`;

  return (
    <MediaPosterGrid
      key={contentKey}
      contentKey={contentKey}
      items={initialContent.items}
      totalSize={initialContent.totalSize}
      pageSize={LIBRARY_PAGE_SIZE}
      onLoadPage={onLoadPage}
      emptyMessage={EMPTY_MESSAGES[kind]}
    />
  );
}
