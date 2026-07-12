"use client";

import type { HubItemWithServer } from "@multiplex/plex-query";
import { MediaPosterGrid } from "~/components/media-poster-grid";
import { LIBRARY_PAGE_SIZE } from "~/server/queries/plex-pagination";
import { api } from "~/trpc/react";

interface LibraryBrowseProps {
  machineIdentifier: string;
  sectionId: string;
  typeNumber?: string;
  sort: string;
  filters: Record<string, string>;
  contentKey: string;
  initialContent: {
    items: HubItemWithServer[];
    totalSize: number;
    offset: number;
  };
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
  const utils = api.useUtils();

  // Plain client call (not `utils.fetch`): the grid caches pages under its
  // own query key, so going through the query cache here would store every
  // page twice.
  const onLoadPage = (input: { start: number; size: number }) =>
    utils.client.plex.getLibraryContent.query({
      machineIdentifier,
      sectionId,
      start: input.start,
      size: input.size,
      sort,
      type: typeNumber,
      filters,
    });

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
