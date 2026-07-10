"use client";

import { useCallback } from "react";
import { MediaPosterGrid } from "~/components/media-poster-grid";
import { fetchLibraryContentPage } from "~/lib/effect/plex-browse-atoms";
import type { LibraryContentPage } from "~/lib/effect/plex-boundary";
import { LIBRARY_PAGE_SIZE } from "~/server/queries/plex-pagination";

interface LibraryBrowseProps {
  machineIdentifier: string;
  sectionId: string;
  typeNumber?: string;
  sort: string;
  filters: Record<string, string>;
  contentKey: string;
  initialContent: LibraryContentPage;
}

export function LibraryBrowse({
  machineIdentifier,
  sectionId,
  typeNumber,
  sort,
  filters,
  contentKey,
  initialContent,
}: LibraryBrowseProps) {
  // Imperative HttpApi fetch (not the page atom): the grid caches pages under
  // its own key, so going through the atom registry here would store every
  // page twice.
  const onLoadPage = useCallback(
    (input: { start: number; size: number }) =>
      fetchLibraryContentPage({
        machineIdentifier,
        sectionId,
        start: input.start,
        size: input.size,
        sort,
        ...(typeNumber !== undefined ? { type: typeNumber } : {}),
        filters,
      }),
    [machineIdentifier, sectionId, sort, typeNumber, filters],
  );

  return (
    <MediaPosterGrid
      key={contentKey}
      contentKey={contentKey}
      items={initialContent.items}
      totalSize={initialContent.totalSize}
      pageSize={LIBRARY_PAGE_SIZE}
      onLoadPage={onLoadPage}
      emptyMessage="No items match these filters."
    />
  );
}
