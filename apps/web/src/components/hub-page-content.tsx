"use client";

import { useCallback } from "react";
import type { HubItemWithServer } from "@multiplex/plex-query";
import { PaginatedPosterGrid } from "~/components/paginated-poster-grid";
import { HUB_PAGE_SIZE } from "~/server/queries/plex-pagination";
import { api } from "~/trpc/react";

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

  const onLoadPage = useCallback(
    (input: { start: number; size: number }) =>
      utils.plex.getHubContent.fetch({
        machineIdentifier,
        hubKey,
        start: input.start,
        size: input.size,
      }),
    [utils, machineIdentifier, hubKey],
  );

  return (
    <PaginatedPosterGrid
      key={`${machineIdentifier}-${hubKey}`}
      initialContent={initialContent}
      pageSize={HUB_PAGE_SIZE}
      onLoadPage={onLoadPage}
      emptyMessage="No items in this collection."
    />
  );
}
