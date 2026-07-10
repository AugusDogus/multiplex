"use client";

import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { MediaHubRow, MediaHubRowSkeleton } from "~/components/media-hub-row";
import { isAsyncResultLoading } from "~/lib/effect/async-result";
import { libraryHubsAtom } from "~/lib/effect/plex-browse-atoms";
import type { LibraryHubsResult } from "~/lib/effect/plex-boundary";

interface LibraryRecommendedProps {
  machineIdentifier: string;
  sectionId: string;
}

export function LibraryRecommended({
  machineIdentifier,
  sectionId,
}: LibraryRecommendedProps) {
  const hubsResult = useAtomValue(
    libraryHubsAtom({ machineIdentifier, sectionId }),
  );
  const hubs = AsyncResult.getOrElse(hubsResult, (): LibraryHubsResult => []);
  // Mirror former `isHubQueryLoading`: skeleton while unsettled *or* while
  // refetching an empty result (TTL 0 remounts).
  const isLoading =
    isAsyncResultLoading(hubsResult) ||
    (AsyncResult.isWaiting(hubsResult) && hubs.length === 0);

  if (isLoading) {
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
