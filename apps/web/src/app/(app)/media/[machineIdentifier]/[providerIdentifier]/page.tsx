import { AppCenteredMessage } from "~/components/app-centered-message";
import { AppPageLayout } from "~/components/app-page-layout";
import { LibraryBrowse } from "~/components/library-browse";
import { LibraryCategories } from "~/components/library-categories";
import { LibraryCollections } from "~/components/library-collections";
import { LibraryControls } from "~/components/library-controls";
import { LibraryHeaderDropdown } from "~/components/library-header-dropdown";
import { LibraryPlaylists } from "~/components/library-playlists";
import { LibraryRecommended } from "~/components/library-recommended";
import { LibraryTabs, SUPPORTED_PIVOT_IDS } from "~/components/library-tabs";
import {
  buildLibraryContentKey,
  extractLibraryFilters,
  getGridTypes,
  resolveActiveType,
  resolveSort,
} from "~/lib/library-browse-params";
import { LIBRARY_PAGE_SIZE } from "~/server/queries/plex-pagination";
import { getAppPlexContext } from "~/server/queries/get-app-plex-context";
import { resolveLibraryTitle } from "~/server/queries/resolve-library-title";
import { api } from "~/trpc/server";

interface PageProps {
  params: Promise<{
    machineIdentifier: string;
    providerIdentifier: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MediaLibraryPage({
  params,
  searchParams,
}: PageProps) {
  const { machineIdentifier } = await params;
  const resolvedSearchParams = await searchParams;
  const source = firstParam(resolvedSearchParams.source);
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

  const pivots = await api.plex.getLibraryPivots({
    machineIdentifier,
    sectionId: source,
  });
  const supportedPivots = pivots.filter((pivot) =>
    SUPPORTED_PIVOT_IDS.includes(pivot.id),
  );

  const requestedPivot =
    firstParam(resolvedSearchParams.pivot) ?? "recommended";
  const activePivot = supportedPivots.some(
    (pivot) => pivot.id === requestedPivot,
  )
    ? requestedPivot
    : "recommended";

  const title = resolveLibraryTitle({
    machineIdentifier,
    sectionId: source,
    userInfo,
  });

  const content = await renderPivotContent({
    activePivot,
    machineIdentifier,
    sectionId: source,
    searchParams: resolvedSearchParams,
  });

  return (
    <AppPageLayout
      title={title}
      mobileHeader={
        <LibraryHeaderDropdown
          libraryTitle={title}
          serverName={serverName}
          servers={servers}
          userInfo={userInfo}
        />
      }
    >
      <LibraryTabs pivots={supportedPivots} />
      {content}
    </AppPageLayout>
  );
}

async function renderPivotContent({
  activePivot,
  machineIdentifier,
  sectionId,
  searchParams,
}: {
  activePivot: string;
  machineIdentifier: string;
  sectionId: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  if (activePivot === "library") {
    const requestedType = firstParam(searchParams.type);
    const requestedSort = firstParam(searchParams.sort);
    const filters = extractLibraryFilters(searchParams);

    const meta = await api.plex.getLibraryMeta({
      machineIdentifier,
      sectionId,
      type: requestedType,
    });
    const { type, typeNumber } = resolveActiveType(meta, requestedType);
    const sort = resolveSort(type, requestedSort);

    const libraryContent = await api.plex.getLibraryContent({
      machineIdentifier,
      sectionId,
      start: 0,
      size: LIBRARY_PAGE_SIZE,
      sort,
      type: typeNumber,
      filters,
    });

    const contentKey = buildLibraryContentKey({
      machineIdentifier,
      sectionId,
      typeNumber,
      sort,
      filters,
    });

    return (
      <div className="flex flex-col gap-4">
        <LibraryControls
          machineIdentifier={machineIdentifier}
          types={getGridTypes(meta)}
          activeType={type}
          activeTypeNumber={typeNumber}
          sort={sort}
          filters={filters}
          totalSize={libraryContent.totalSize}
        />
        <LibraryBrowse
          machineIdentifier={machineIdentifier}
          sectionId={sectionId}
          typeNumber={typeNumber}
          sort={sort}
          filters={filters}
          contentKey={contentKey}
          initialContent={libraryContent}
        />
      </div>
    );
  }

  if (activePivot === "collections") {
    const collections = await api.plex.getLibraryCollections({
      machineIdentifier,
      sectionId,
      start: 0,
      size: LIBRARY_PAGE_SIZE,
    });

    return (
      <LibraryCollections
        machineIdentifier={machineIdentifier}
        sectionId={sectionId}
        initialContent={collections}
      />
    );
  }

  if (activePivot === "categories") {
    const { categories } = await api.plex.getLibraryCategories({
      machineIdentifier,
      sectionId,
    });

    return (
      <LibraryCategories
        machineIdentifier={machineIdentifier}
        sectionId={sectionId}
        categories={categories}
      />
    );
  }

  if (activePivot === "playlists") {
    const playlists = await api.plex.getLibraryPlaylists({
      machineIdentifier,
      sectionId,
      start: 0,
      size: LIBRARY_PAGE_SIZE,
    });

    return (
      <LibraryPlaylists
        machineIdentifier={machineIdentifier}
        sectionId={sectionId}
        initialContent={playlists}
      />
    );
  }

  const libraryHubs = await api.plex.getLibraryHubs({
    machineIdentifier,
    sectionId,
  });

  return (
    <LibraryRecommended
      machineIdentifier={machineIdentifier}
      sectionId={sectionId}
      initialHubs={libraryHubs}
    />
  );
}
