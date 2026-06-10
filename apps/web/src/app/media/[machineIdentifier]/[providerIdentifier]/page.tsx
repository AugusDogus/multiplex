import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LibraryBrowse } from "~/components/library-browse";
import { LibraryHeaderDropdown } from "~/components/library-header-dropdown";
import { LibraryPageShell } from "~/components/library-page-shell";
import { auth } from "~/lib/auth/server";
import { LIBRARY_PAGE_SIZE } from "~/server/queries/plex-pagination";
import { resolveLibraryTitle } from "~/server/queries/resolve-library-title";
import { api } from "~/trpc/server";

interface PageProps {
  params: Promise<{
    machineIdentifier: string;
    providerIdentifier: string;
  }>;
  searchParams: Promise<{
    source?: string;
  }>;
}

export default async function MediaLibraryPage({
  params,
  searchParams,
}: PageProps) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  const { machineIdentifier, providerIdentifier } = await params;
  const { source } = await searchParams;

  const [servers, userInfo] = await Promise.all([
    api.plex.getServers(),
    api.plex.getUserInfo(),
  ] as const);

  if (!servers || !userInfo) {
    return null;
  }

  if (servers.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome to Multiplex</h1>
          <p className="text-muted-foreground mt-2">
            No Plex servers found. Please configure your Plex account.
          </p>
        </div>
      </div>
    );
  }

  const currentServer = servers.find(
    (server) => server.clientIdentifier === machineIdentifier,
  );
  const serverName = currentServer?.name ?? "Plex server";

  if (!source) {
    return (
      <LibraryPageShell
        session={session}
        servers={servers}
        userInfo={userInfo}
        title="Library"
      >
        <p className="text-muted-foreground text-sm">
          Select a library from the sidebar to browse your collection.
        </p>
      </LibraryPageShell>
    );
  }

  const [libraryHubs, libraryContent, serverLibraries] = await Promise.all([
    api.plex.getLibraryHubs({ machineIdentifier, sectionId: source }),
    api.plex.getLibraryContent({
      machineIdentifier,
      sectionId: source,
      start: 0,
      size: LIBRARY_PAGE_SIZE,
    }),
    api.plex.getAllServerLibraries(),
  ]);

  const breadcrumbTitle = resolveLibraryTitle({
    machineIdentifier,
    providerIdentifier,
    sectionId: source,
    userInfo,
    serverName,
    serverLibraries,
    librarySectionTitle: libraryContent.librarySectionTitle,
  });

  return (
    <LibraryPageShell
      session={session}
      servers={servers}
      userInfo={userInfo}
      title={breadcrumbTitle}
      mobileHeader={
        <LibraryHeaderDropdown
          libraryTitle={breadcrumbTitle}
          serverName={serverName}
          servers={servers}
          userInfo={userInfo}
        />
      }
    >
      <LibraryBrowse
        machineIdentifier={machineIdentifier}
        sectionId={source}
        initialHubs={libraryHubs}
        initialContent={libraryContent}
      />
    </LibraryPageShell>
  );
}
