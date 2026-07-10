"use client";

import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Option from "effect/Option";

import { AppHeader } from "~/components/app-header";
import { MediaItemDetails } from "~/components/media-item-details";
import { MediaItemDetailsSkeleton } from "~/components/media-item-details/media-item-details-skeleton";
import { isAsyncResultLoading } from "~/lib/effect/async-result";
import { itemDetailsAtom } from "~/lib/effect/plex-atoms";
import {
  getItemDetailsBreadcrumbs,
  type ItemDetailsRouteType,
} from "~/lib/plex-routes";

interface MediaItemDetailsPageClientProps {
  serverId: string;
  ratingKey: string;
  itemType: ItemDetailsRouteType | "media";
}

export function MediaItemDetailsPageClient({
  serverId,
  ratingKey,
  itemType,
}: MediaItemDetailsPageClientProps) {
  const detailsResult = useAtomValue(itemDetailsAtom({ serverId, ratingKey }));
  const details =
    Option.getOrUndefined(AsyncResult.value(detailsResult)) ?? undefined;
  const isPending = isAsyncResultLoading(detailsResult);
  const isError = AsyncResult.isFailure(detailsResult);

  if (isPending && !details) {
    return (
      <>
        <AppHeader />
        <main className="flex min-w-0 flex-1 flex-col p-4">
          <MediaItemDetailsSkeleton variant={itemType} />
        </main>
      </>
    );
  }

  if (isError || !details) {
    return (
      <>
        <AppHeader>Details unavailable</AppHeader>
        <main className="flex min-w-0 flex-1 flex-col p-4">
          <div className="text-muted-foreground rounded-xl border p-6 text-sm">
            This item could not be loaded from Plex.
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader
        breadcrumbs={getItemDetailsBreadcrumbs(details.item, serverId)}
      />
      <main className="flex min-w-0 flex-1 flex-col p-4">
        <MediaItemDetails details={details} serverId={serverId} />
      </main>
    </>
  );
}
