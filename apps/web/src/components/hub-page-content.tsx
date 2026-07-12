"use client";

import type { HubItemWithServer } from "@multiplex/plex-query";
import { MediaPosterGrid } from "~/components/media-poster-grid";
import { HUB_PAGE_SIZE } from "~/server/queries/plex-pagination";
import { api } from "~/trpc/api";

interface HubPageContentProps {
  machineIdentifier: string;
  hubKey: string;
  initialContent: {
    items: HubItemWithServer[];
    totalSize: number;
    offset: number;
  };
}

export function HubPageContent({
  machineIdentifier,
  hubKey,
  initialContent,
}: HubPageContentProps) {
  const utils = api.useUtils();

  // Plain client call (not `utils.fetch`): the grid caches pages under its
  // own query key, so going through the query cache here would store every
  // page twice.
  const onLoadPage = (input: { start: number; size: number }) =>
    utils.client.plex.getHubContent.query({
      machineIdentifier,
      hubKey,
      start: input.start,
      size: input.size,
    });

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
