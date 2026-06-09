"use client";

import { useCallback } from "react";
import type { HubItemWithServer } from "@multiplex/plex-query";
import { MediaPosterGrid } from "~/components/media-poster-grid";
import { api } from "~/trpc/react";

interface HubBrowseProps {
  machineIdentifier: string;
  hubKey: string;
  initialContent: {
    items: HubItemWithServer[];
    totalSize: number;
    offset: number;
  };
}

const PAGE_SIZE = 48;

export function HubBrowse({
  machineIdentifier,
  hubKey,
  initialContent,
}: HubBrowseProps) {
  const utils = api.useUtils();

  const onLoadMore = useCallback(
    async (start: number) => {
      return utils.plex.getHubContent.fetch({
        machineIdentifier,
        hubKey,
        start,
        size: PAGE_SIZE,
      });
    },
    [utils, machineIdentifier, hubKey],
  );

  return (
    <MediaPosterGrid
      items={initialContent.items}
      totalSize={initialContent.totalSize}
      onLoadMore={onLoadMore}
      emptyMessage="No items in this collection."
    />
  );
}
