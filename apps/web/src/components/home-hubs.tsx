"use client";

import { MediaHubRow, MediaHubRowSkeleton } from "~/components/media-hub-row";
import { api } from "~/trpc/react";

export function HomeHubs() {
  const {
    data: hubs = [],
    isPending,
    isError,
    isFetching,
  } = api.plex.getHomeHubs.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const isRecovering = isError && isFetching;

  if ((isPending || isRecovering) && hubs.length === 0) {
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
