"use client";

import { MediaHubRow, MediaHubRowSkeleton } from "~/components/media-hub-row";
import {
  isHubQueryLoading,
  PLEX_HUB_QUERY_OPTIONS,
} from "~/lib/plex-hub-query-options";
import { api } from "~/trpc/react";

interface LibraryRecommendedProps {
  machineIdentifier: string;
  sectionId: string;
}

export function LibraryRecommended({
  machineIdentifier,
  sectionId,
}: LibraryRecommendedProps) {
  const {
    data: hubs = [],
    isPending,
    isFetching,
  } = api.plex.getLibraryHubs.useQuery(
    { machineIdentifier, sectionId },
    PLEX_HUB_QUERY_OPTIONS,
  );

  if (isHubQueryLoading(isPending, isFetching, hubs.length)) {
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
