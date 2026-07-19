import { notFound } from "next/navigation";

import { MediaItemDetailsPageClient } from "~/components/media-item-details-page-client";
import type { ItemDetailsRouteType } from "~/lib/plex-routes";
import { api, HydrateClient } from "~/trpc/server";

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

  await api.plex.getItemDetails.prefetch({
    serverId: machineIdentifier,
    ratingKey,
  });

  return (
    <HydrateClient>
      <MediaItemDetailsPageClient
        serverId={machineIdentifier}
        ratingKey={ratingKey}
        itemType={itemType}
      />
    </HydrateClient>
  );
}
