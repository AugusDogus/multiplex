"use client";

import type { HubWithServer } from "@multiplex/plex-query";
import { MediaHubRow, MediaHubRowSkeleton } from "~/components/media-hub-row";
import {
  isAwaitingSsrRetry,
  ssrSeededQueryOptions,
} from "~/lib/ssr-seeded-query";
import { api } from "~/trpc/react";

interface HomeHubsProps {
  hubs: HubWithServer[];
}

export function HomeHubs({ hubs: initialHubs }: HomeHubsProps) {
  const {
    data: hubs,
    isLoading,
    isFetching,
  } = api.plex.getHomeHubs.useQuery(undefined, {
    ...ssrSeededQueryOptions(initialHubs, 5 * 60 * 1000),
    refetchOnWindowFocus: false,
  });

  if (
    (isLoading || isAwaitingSsrRetry(hubs, isFetching)) &&
    hubs.length === 0
  ) {
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
