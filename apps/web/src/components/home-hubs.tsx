"use client";

import { MediaHubRow, MediaHubRowSkeleton } from "~/components/media-hub-row";
import { api } from "~/trpc/react";

export function HomeHubs() {
  const {
    data: hubs = [],
    isPending,
    isFetching,
  } = api.plex.getHomeHubs.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    // SSR prefetch can succeed with a transient empty result on cold start.
    // Always verify on mount so hydrated [] recovers without a manual refresh.
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  if ((isPending || isFetching) && hubs.length === 0) {
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
