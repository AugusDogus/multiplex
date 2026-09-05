import { Suspense } from "react";
import type { LibraryPivotId } from "@multiplex/plex-query";
import { AppCenteredMessage } from "~/components/app-centered-message";
import { AppPageLayout } from "~/components/app-page-layout";
import { LibraryBrowse } from "~/components/library-browse";
import { LibraryCategories } from "~/components/library-categories";
import { LibraryControls } from "~/components/library-controls";
import { LibraryHeaderDropdown } from "~/components/library-header-dropdown";
import { LibraryPivotSkeleton } from "~/components/library-pivot-skeleton";
import { LibraryPosterTab } from "~/components/library-poster-tab";
import { LibraryRecommended } from "~/components/library-recommended";
import { LibraryTabs } from "~/components/library-tabs";
import { SUPPORTED_PIVOT_IDS, isSupportedPivot } from "~/lib/library-constants";
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
import { api, HydrateClient } from "~/trpc/server";

// Session-bound library chrome + hubs: partialPrefetching caches the shell
// per session; the sidebar library links opt in with `<Link prefetch>` (true)
// so URL data resolves before the click.

interface PageProps {
  params: Promise<{
    machineIdentifier: string;
    providerIdentifier: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface PivotContentProps {
  activePivot: LibraryPivotId;
  machineIdentifier: string;
  sectionId: string;
  searchParams: Record<string, string | string[] | undefined>;
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
  const requestedPivotParam =
    firstParam(resolvedSearchParams.pivot) ?? "recommended";

  // Overlap account bootstrap with library data — do not serialize
  // getAppPlexContext → pivots → hubs on the soft-nav critical path.
  const contextPromise = getAppPlexContext();
  const pivotsPromise = source
    ? api.plex.getLibraryPivots({
        machineIdentifier,
        sectionId: source,
      })
    : null;
  if (
    source &&
    (!isSupportedPivot(requestedPivotParam) ||
      requestedPivotParam === "recommended")
  ) {
    void api.plex.getLibraryHubs.prefetch({
      machineIdentifier,
      sectionId: source,
    });
  }

  const { servers, userInfo } = await contextPromise;

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

  if (!source || !pivotsPromise) {
    return (
      <AppPageLayout title="Library">
        <p className="text-muted-foreground text-sm">
          Select a library from the sidebar to browse your collection.
        </p>
      </AppPageLayout>
    );
  }

  const { title: librarySectionTitle, pivots } = await pivotsPromise;
  const supportedPivots = pivots.filter((pivot) =>
    SUPPORTED_PIVOT_IDS.includes(pivot.id),
  );

  const activePivot: LibraryPivotId =
    isSupportedPivot(requestedPivotParam) &&
    supportedPivots.some((pivot) => pivot.id === requestedPivotParam)
      ? requestedPivotParam
      : "recommended";

  const title = resolveLibraryTitle({
    machineIdentifier,
    sectionId: source,
    userInfo,
    librarySectionTitle,
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
      headerCenter={<LibraryTabs pivots={supportedPivots} />}
    >
      <Suspense
        key={activePivot}
        fallback={<LibraryPivotSkeleton pivot={activePivot} />}
      >
        <LibraryPivotContent
          activePivot={activePivot}
          machineIdentifier={machineIdentifier}
          sectionId={source}
          searchParams={resolvedSearchParams}
        />
      </Suspense>
    </AppPageLayout>
  );
}

async function LibraryPivotContent(props: PivotContentProps) {
  const { activePivot, machineIdentifier, sectionId } = props;

  switch (activePivot) {
    case "library":
      return renderLibraryTab(props);

    case "collections": {
      const collections = await api.plex.getLibraryCollections({
        machineIdentifier,
        sectionId,
        start: 0,
        size: LIBRARY_PAGE_SIZE,
      });
      return (
        <LibraryPosterTab
          kind="collections"
          machineIdentifier={machineIdentifier}
          sectionId={sectionId}
          initialContent={collections}
        />
      );
    }

    case "playlists": {
      const playlists = await api.plex.getLibraryPlaylists({
        machineIdentifier,
        sectionId,
        start: 0,
        size: LIBRARY_PAGE_SIZE,
      });
      return (
        <LibraryPosterTab
          kind="playlists"
          machineIdentifier={machineIdentifier}
          sectionId={sectionId}
          initialContent={playlists}
        />
      );
    }

    case "categories": {
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

    case "recommended": {
      await api.plex.getLibraryHubs.prefetch({
        machineIdentifier,
        sectionId,
      });
      return (
        <HydrateClient>
          <LibraryRecommended
            machineIdentifier={machineIdentifier}
            sectionId={sectionId}
          />
        </HydrateClient>
      );
    }

    default: {
      const _exhaustive: never = activePivot;
      return _exhaustive;
    }
  }
}

async function renderLibraryTab({
  machineIdentifier,
  sectionId,
  searchParams,
}: PivotContentProps) {
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
