"use client";

import { MediaHubRow, MediaHubRowSkeleton } from "~/components/media-hub-row";
import { isHubQueryLoading } from "~/lib/plex-hub-query-options";
import { useSyncedLibraryHubs } from "~/lib/sync-engine";

interface LibraryRecommendedProps {
  machineIdentifier: string;
  sectionId: string;
}

export function LibraryRecommended({
  machineIdentifier,
  sectionId,
}: LibraryRecommendedProps) {
  const { hubs, isPending, isFetching } = useSyncedLibraryHubs(
    machineIdentifier,
    sectionId,
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
