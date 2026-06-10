import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { HubPageContent } from "~/components/hub-page-content";
import { LibraryPageShell } from "~/components/library-page-shell";
import { auth } from "~/lib/auth/server";
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
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  const { machineIdentifier } = await params;
  const { key: hubKey, title } = await searchParams;

  if (!hubKey) {
    notFound();
  }

  const [servers, userInfo, hubContent] = await Promise.all([
    api.plex.getServers(),
    api.plex.getUserInfo(),
    api.plex.getHubContent({
      machineIdentifier,
      hubKey,
      start: 0,
      size: HUB_PAGE_SIZE,
    }),
  ] as const);

  if (!servers || !userInfo) {
    return null;
  }

  return (
    <LibraryPageShell
      session={session}
      servers={servers}
      userInfo={userInfo}
      title={title ?? "Collection"}
    >
      <HubPageContent
        machineIdentifier={machineIdentifier}
        hubKey={hubKey}
        initialContent={hubContent}
      />
    </LibraryPageShell>
  );
}
