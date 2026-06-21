"use client";

import { MediaHubRow, MediaHubRowSkeleton } from "~/components/media-hub-row";
import {
  isHubQueryLoading,
  PLEX_HUB_QUERY_OPTIONS,
} from "~/lib/plex-hub-query-options";
import { api } from "~/trpc/react";

export function HomeHubs() {
  const {
    data: hubs = [],
    isPending,
    isFetching,
  } = api.plex.getHomeHubs.useQuery(undefined, PLEX_HUB_QUERY_OPTIONS);

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
