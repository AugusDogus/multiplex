import { AppCenteredMessage } from "~/components/app-centered-message";
import { AppPageLayout } from "~/components/app-page-layout";
import { LibraryBrowse } from "~/components/library-browse";
import { LibraryHeaderDropdown } from "~/components/library-header-dropdown";
import { LIBRARY_PAGE_SIZE } from "~/server/queries/plex-pagination";
import { getAppPlexContext } from "~/server/queries/get-app-plex-context";
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
  const { machineIdentifier } = await params;
  const { source } = await searchParams;
  const { servers, userInfo } = await getAppPlexContext();

  const currentServer = servers.find(
    (server) => server.clientIdentifier === machineIdentifier,
  );
  const serverName = currentServer?.name ?? "Plex server";

  if (!currentServer) {
    return (
      <AppCenteredMessage
        title="Server Not Found"
        description="The requested Plex server could not be found or is not accessible."
      />
    );
  }

  if (!source) {
    return (
      <AppPageLayout title="Library">
        <p className="text-muted-foreground text-sm">
          Select a library from the sidebar to browse your collection.
        </p>
      </AppPageLayout>
    );
  }

  const [libraryHubs, libraryContent] = await Promise.all([
    api.plex.getLibraryHubs({ machineIdentifier, sectionId: source }),
    api.plex.getLibraryContent({
      machineIdentifier,
      sectionId: source,
      start: 0,
      size: LIBRARY_PAGE_SIZE,
    }),
  ]);

  const breadcrumbTitle = resolveLibraryTitle({
    machineIdentifier,
    sectionId: source,
    userInfo,
    librarySectionTitle: libraryContent.librarySectionTitle,
  });

  return (
    <AppPageLayout
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
    </AppPageLayout>
  );
}
