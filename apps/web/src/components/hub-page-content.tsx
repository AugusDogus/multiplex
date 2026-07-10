"use client";

import { useCallback } from "react";
import { MediaPosterGrid } from "~/components/media-poster-grid";
import { fetchHubContentPage } from "~/lib/effect/plex-browse-atoms";
import type { HubContentPage } from "~/lib/effect/plex-boundary";
import { HUB_PAGE_SIZE } from "~/server/queries/plex-pagination";

interface HubPageContentProps {
  machineIdentifier: string;
  hubKey: string;
  initialContent: HubContentPage;
}

export function HubPageContent({
  machineIdentifier,
  hubKey,
  initialContent,
}: HubPageContentProps) {
  // Imperative HttpApi fetch (not the page atom): the grid caches pages under
  // its own key, so going through the atom registry here would store every
  // page twice.
  const onLoadPage = useCallback(
    (input: { start: number; size: number }) =>
      fetchHubContentPage({
        machineIdentifier,
        hubKey,
        start: input.start,
        size: input.size,
      }),
    [machineIdentifier, hubKey],
  );

  const contentKey = `${machineIdentifier}-${hubKey}`;

  return (
    <MediaPosterGrid
      key={contentKey}
      contentKey={contentKey}
      items={initialContent.items}
      totalSize={initialContent.totalSize}
      pageSize={HUB_PAGE_SIZE}
      onLoadPage={onLoadPage}
      emptyMessage="No items in this collection."
    />
  );
}
