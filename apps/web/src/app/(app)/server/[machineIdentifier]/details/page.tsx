import { notFound } from "next/navigation";
import { ViewTransition } from "react";

import { AppHeader } from "~/components/app-header";
import { MediaItemDetails } from "~/components/media-item-details";
import { ViewTransitionPage } from "~/components/view-transition-page";
import {
  getItemDetailsBreadcrumbs,
  parseItemDetailsKey,
} from "~/lib/plex-routes";
import { api } from "~/trpc/server";

interface PageProps {
  params: Promise<{
    machineIdentifier: string;
  }>;
  searchParams: Promise<{
    key?: string;
  }>;
}

export default async function MediaItemDetailsPage({
  params,
  searchParams,
}: PageProps) {
  const { machineIdentifier } = await params;
  const { key } = await searchParams;
  const ratingKey = parseItemDetailsKey(key);

  if (!ratingKey) {
    notFound();
  }

  const details = await api.plex.getItemDetails({
    serverId: machineIdentifier,
    ratingKey,
  });

  if (!details) {
    notFound();
  }

  return (
    <>
      <AppHeader
        breadcrumbs={getItemDetailsBreadcrumbs(details.item, machineIdentifier)}
      />
      <ViewTransitionPage>
        <ViewTransition enter="slide-up" default="none">
          <main className="flex min-w-0 flex-1 flex-col p-4">
            <MediaItemDetails details={details} serverId={machineIdentifier} />
          </main>
        </ViewTransition>
      </ViewTransitionPage>
    </>
  );
}
