"use client";

import { useCallback } from "react";
import type { HubItemWithServer } from "@multiplex/plex-query";
import { MediaPosterGrid } from "~/components/media-poster-grid";
import { LIBRARY_PAGE_SIZE } from "~/server/queries/plex-pagination";
import { api } from "~/trpc/react";

interface LibraryCollectionsProps {
  machineIdentifier: string;
  sectionId: string;
  initialContent: {
    items: HubItemWithServer[];
    totalSize: number;
    offset: number;
  };
}

export function LibraryCollections({
  machineIdentifier,
  sectionId,
  initialContent,
}: LibraryCollectionsProps) {
  const utils = api.useUtils();

  const onLoadPage = useCallback(
    (input: { start: number; size: number }) =>
      utils.client.plex.getLibraryCollections.query({
        machineIdentifier,
        sectionId,
        start: input.start,
        size: input.size,
      }),
    [utils, machineIdentifier, sectionId],
  );

  const contentKey = `${machineIdentifier}-${sectionId}-collections`;

  return (
    <MediaPosterGrid
      key={contentKey}
      contentKey={contentKey}
      items={initialContent.items}
      totalSize={initialContent.totalSize}
      pageSize={LIBRARY_PAGE_SIZE}
      onLoadPage={onLoadPage}
      emptyMessage="No collections in this library."
    />
  );
}
