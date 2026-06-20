"use client";

import { MediaHubRow, MediaHubRowSkeleton } from "~/components/media-hub-row";
import { api } from "~/trpc/react";

interface LibraryRecommendedProps {
  machineIdentifier: string;
  sectionId: string;
}

export function LibraryRecommended({
  machineIdentifier,
  sectionId,
}: LibraryRecommendedProps) {
  const { data: hubs = [], isPending } = api.plex.getLibraryHubs.useQuery(
    { machineIdentifier, sectionId },
    {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  );

  if (isPending && hubs.length === 0) {
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
