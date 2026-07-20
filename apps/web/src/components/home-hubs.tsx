"use client";

import { MediaHubRow, MediaHubRowSkeleton } from "~/components/media-hub-row";
import { isHubQueryLoading } from "~/lib/plex-hub-query-options";
import { toHubWithServer, useSyncedHomeHubs } from "~/lib/sync-engine";

export function HomeHubs() {
  const { data: rows, isLoading, isReady } = useSyncedHomeHubs();
  const hubs = rows.map(toHubWithServer);
  const isPending = !isReady || (isLoading && hubs.length === 0);
  const isFetching = Boolean(isLoading && hubs.length > 0);

  if (isHubQueryLoading(isPending, isFetching, hubs.length)) {
    return (
      <>
        <MediaHubRowSkeleton />
        <MediaHubRowSkeleton />
      </>
    );
  }

  if (hubs.length === 0) {
    return null;
  }

  return (
    <>
      {hubs.map((hub) => (
        <MediaHubRow key={`${hub.serverId}-${hub.hubIdentifier}`} hub={hub} />
      ))}
    </>
  );
}
