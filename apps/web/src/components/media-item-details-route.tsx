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

/**
 * Soft-nav paints from the client TanStack cache filled by poster hover
 * prefetch. Do not wrap in HydrateClient with a voided server prefetch —
 * dehydrating a pending query overwrites the warm client cache and forces a
 * refetch (slower than Plex).
 */
export async function MediaItemDetailsRoute({
  params,
  itemType,
}: MediaItemDetailsRouteProps) {
  const { machineIdentifier, ratingKey } = await params;

  if (!ratingKey) {
    notFound();
  }

  return (
    <MediaItemDetailsPageClient
      serverId={machineIdentifier}
      ratingKey={ratingKey}
      itemType={itemType}
    />
  );
}
