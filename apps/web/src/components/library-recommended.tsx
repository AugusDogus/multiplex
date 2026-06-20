"use client";

import type { HubWithServer } from "@multiplex/plex-query";
import { MediaHubRow, MediaHubRowSkeleton } from "~/components/media-hub-row";
import {
  isAwaitingSsrRetry,
  ssrSeededQueryOptions,
} from "~/lib/ssr-seeded-query";
import { api } from "~/trpc/react";

interface LibraryRecommendedProps {
  machineIdentifier: string;
  sectionId: string;
  initialHubs: HubWithServer[];
}

export function LibraryRecommended({
  machineIdentifier,
  sectionId,
  initialHubs,
}: LibraryRecommendedProps) {
  const {
    data: hubs,
    isLoading,
    isFetching,
  } = api.plex.getLibraryHubs.useQuery(
    { machineIdentifier, sectionId },
    {
      ...ssrSeededQueryOptions(initialHubs, 5 * 60 * 1000),
      refetchOnWindowFocus: false,
    },
  );

  if (
    (isLoading || isAwaitingSsrRetry(hubs, isFetching)) &&
    hubs.length === 0
  ) {
    return (
      <div className="flex flex-col gap-8">
        <MediaHubRowSkeleton />
        <MediaHubRowSkeleton />
      </div>
    );
  }

  if (hubs.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing recommended in this library yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {hubs.map((hub) => (
        <MediaHubRow key={`${hub.serverId}-${hub.hubIdentifier}`} hub={hub} />
      ))}
    </div>
  );
}
