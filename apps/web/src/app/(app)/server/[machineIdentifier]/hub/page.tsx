import { notFound } from "next/navigation";

import { HubPageContent } from "~/components/hub-page-content";
import { AppPageLayout } from "~/components/app-page-layout";
import { HUB_PAGE_SIZE } from "~/server/queries/plex-pagination";
import { api } from "~/trpc/server";

interface PageProps {
  params: Promise<{
    machineIdentifier: string;
  }>;
  searchParams: Promise<{
    key?: string;
    title?: string;
  }>;
}

export default async function HubPage({ params, searchParams }: PageProps) {
  const { machineIdentifier } = await params;
  const { key: hubKey, title } = await searchParams;

  if (!hubKey) {
    notFound();
  }

  const hubContent = await api.plex.getHubContent({
    machineIdentifier,
    hubKey,
    start: 0,
    size: HUB_PAGE_SIZE,
  });

  return (
    <AppPageLayout title={title ?? "Collection"}>
      <HubPageContent
        machineIdentifier={machineIdentifier}
        hubKey={hubKey}
        initialContent={hubContent}
      />
    </AppPageLayout>
  );
}
