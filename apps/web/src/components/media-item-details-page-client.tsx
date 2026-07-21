"use client";

import { AppHeader } from "~/components/app-header";
import { MediaItemDetails } from "~/components/media-item-details";
import { MediaItemDetailsSkeleton } from "~/components/media-item-details/media-item-details-skeleton";
import {
  getItemDetailsBreadcrumbs,
  type ItemDetailsRouteType,
} from "~/lib/plex-routes";
import { useSyncedItemDetails } from "~/lib/sync-engine";

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
  const { details, error, isPending, isFetching } = useSyncedItemDetails(
    serverId,
    ratingKey,
  );

  // Prefer cached/prefetched details immediately — never blank the page on a
  // background refetch when we already have a payload (Plex soft-nav feel).
  if (!details && (isPending || isFetching)) {
    return (
      <>
        <AppHeader />
        <main className="flex min-w-0 flex-1 flex-col p-4">
          <MediaItemDetailsSkeleton variant={itemType} />
        </main>
      </>
    );
  }

  if (error || !details) {
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
