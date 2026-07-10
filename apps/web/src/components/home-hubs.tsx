"use client";

import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";

import { MediaHubRow, MediaHubRowSkeleton } from "~/components/media-hub-row";
import { isAsyncResultLoading } from "~/lib/effect/async-result";
import type { HomeHubsResult } from "~/lib/effect/plex-boundary";
import { homeHubsAtom } from "~/lib/effect/plex-browse-atoms";

export function HomeHubs() {
  const hubsResult = useAtomValue(homeHubsAtom);
  const hubs = AsyncResult.getOrElse(hubsResult, (): HomeHubsResult => []);

  if (isAsyncResultLoading(hubsResult)) {
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
