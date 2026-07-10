import { notFound } from "next/navigation";

import { MediaItemDetailsPageClient } from "~/components/media-item-details-page-client";
import type { ItemDetailsRouteType } from "~/lib/plex-routes";

interface MediaItemDetailsRouteProps {
  params: Promise<{
    machineIdentifier: string;
    ratingKey: string;
  }>;
  itemType: ItemDetailsRouteType | "media";
}

export async function MediaItemDetailsRoute({
  params,
  itemType,
}: MediaItemDetailsRouteProps) {
  const { machineIdentifier, ratingKey } = await params;

  if (!ratingKey) {
    notFound();
  }

  // Prefetch was tRPC/React Query only; the client atom owns the read now.
  return (
    <MediaItemDetailsPageClient
      serverId={machineIdentifier}
      ratingKey={ratingKey}
      itemType={itemType}
    />
  );
}
