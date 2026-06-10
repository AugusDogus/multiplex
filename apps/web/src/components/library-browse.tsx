"use client";

import { useCallback } from "react";
import type { HubItemWithServer, HubWithServer } from "@multiplex/plex-query";
import { MediaHubRow, MediaHubRowSkeleton } from "~/components/media-hub-row";
import { PaginatedPosterGrid } from "~/components/paginated-poster-grid";
import { LIBRARY_PAGE_SIZE } from "~/server/queries/plex-pagination";
import { api } from "~/trpc/react";

interface LibraryBrowseProps {
  machineIdentifier: string;
  sectionId: string;
  initialHubs: HubWithServer[];
  initialContent: {
    items: HubItemWithServer[];
    totalSize: number;
    offset: number;
    librarySectionTitle?: string;
  };
}

export function LibraryBrowse({
  machineIdentifier,
  sectionId,
  initialHubs,
  initialContent,
}: LibraryBrowseProps) {
  const utils = api.useUtils();

  const { data: hubs, isLoading: hubsLoading } =
    api.plex.getLibraryHubs.useQuery(
      { machineIdentifier, sectionId },
      {
        initialData: initialHubs,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
      },
    );

  const onLoadPage = useCallback(
    (input: { start: number; size: number }) =>
      utils.plex.getLibraryContent.fetch({
        machineIdentifier,
        sectionId,
        start: input.start,
        size: input.size,
      }),
    [utils, machineIdentifier, sectionId],
  );

  return (
    <div className="flex flex-col gap-8">
      {hubsLoading && hubs.length === 0 ? (
        <>
          <MediaHubRowSkeleton />
          <MediaHubRowSkeleton />
        </>
      ) : (
        hubs.map((hub) => (
          <MediaHubRow key={`${hub.serverId}-${hub.hubIdentifier}`} hub={hub} />
        ))
      )}

      <section className="flex flex-col gap-y-4">
        <div className="px-4 md:px-8">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
            All {initialContent.librarySectionTitle ?? "Titles"}
          </h2>
        </div>

        <PaginatedPosterGrid
          initialContent={initialContent}
          pageSize={LIBRARY_PAGE_SIZE}
          onLoadPage={onLoadPage}
          emptyMessage="No items found in this library."
        />
      </section>
    </div>
  );
}
