"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useQueries } from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { HubItemWithServer } from "@multiplex/plex-query";
import { MediaPosterCard } from "~/components/media-poster-card";
import { Skeleton } from "~/components/ui/skeleton";
import {
  estimatePosterGridTrackWidth,
  getPosterGridColumnsForWidth,
  getPosterGridColumnsStyle,
  getPosterGridRowHeightEstimate,
  measurePosterGridTrackWidth,
  POSTER_GRID_CONTAINER_CLASSNAME,
  POSTER_GRID_ROW_CLASSNAME,
} from "~/lib/poster-grid-layout";

export interface PaginatedPosterResult {
  items: HubItemWithServer[];
  totalSize: number;
}

interface MediaPosterGridProps {
  /**
   * Stable identity of the content source (e.g. `${machineIdentifier}-${sectionId}`);
   * scopes the page cache. Pass the same value as the component `key`.
   */
  contentKey: string;
  /** Full first page of items, server-rendered. */
  items: HubItemWithServer[];
  totalSize: number;
  pageSize: number;
  onLoadPage?: (input: {
    start: number;
    size: number;
  }) => Promise<PaginatedPosterResult | null>;
  emptyMessage?: string;
}

export function PosterCardSkeleton() {
  return (
    <div className="flex shrink-0 flex-col gap-2">
      <Skeleton className="h-[180px] w-[120px] rounded-md sm:h-[210px] sm:w-[140px] md:h-[240px] md:w-[160px]" />
      <div className="flex w-[120px] flex-col sm:w-[140px] md:w-[160px]">
        <Skeleton className="h-[18px] w-full rounded-sm" />
        <Skeleton className="h-[15px] w-2/3 rounded-sm" />
      </div>
    </div>
  );
}

function PosterGridCell({ item }: { item?: HubItemWithServer }) {
  if (item) {
    return <MediaPosterCard item={item} layout="grid" />;
  }

  return <PosterCardSkeleton />;
}

interface PosterGridRowProps {
  columns: number;
  viewportWidth: number;
  cellCount: number;
  startIndex: number;
  resolvedItems: (HubItemWithServer | undefined)[];
  className?: string;
  style?: React.CSSProperties;
  measureElement?: (element: Element | null) => void;
  rowIndex?: number;
}

function PosterGridRow({
  columns,
  viewportWidth,
  cellCount,
  startIndex,
  resolvedItems,
  className,
  style,
  measureElement,
  rowIndex,
}: PosterGridRowProps) {
  return (
    <div
      data-index={rowIndex}
      ref={measureElement}
      className={className ?? POSTER_GRID_ROW_CLASSNAME}
      style={{
        ...getPosterGridColumnsStyle(columns, viewportWidth),
        ...style,
      }}
    >
      {Array.from({ length: cellCount }, (_, column) => {
        const item = resolvedItems[startIndex + column];
        return item ? (
          <PosterGridCell
            key={`${item.serverId}-${item.ratingKey}`}
            item={item}
          />
        ) : (
          <PosterGridCell key={`skeleton-${startIndex + column}`} />
        );
      })}
    </div>
  );
}

function subscribeViewport(callback: () => void) {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
}

function getViewportWidthSnapshot() {
  return window.innerWidth;
}

function getViewportWidthServerSnapshot() {
  return 1920;
}

function useViewportWidth() {
  return useSyncExternalStore(
    subscribeViewport,
    getViewportWidthSnapshot,
    getViewportWidthServerSnapshot,
  );
}

function usePosterGridLayout(containerEl: HTMLDivElement | null) {
  const viewportWidth = useViewportWidth();
  const [measuredTrackWidth, setMeasuredTrackWidth] = useState<number | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!containerEl) {
      return;
    }

    const measure = () => {
      const width = measurePosterGridTrackWidth(containerEl);
      if (width > 0) {
        setMeasuredTrackWidth(width);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(containerEl);
    return () => observer.disconnect();
  }, [containerEl]);

  const syncTrackWidth =
    containerEl !== null ? measurePosterGridTrackWidth(containerEl) : 0;
  const trackWidth =
    measuredTrackWidth ??
    (syncTrackWidth > 0 ? syncTrackWidth : null) ??
    estimatePosterGridTrackWidth(viewportWidth);

  const columns = getPosterGridColumnsForWidth(trackWidth, viewportWidth);

  return { columns, viewportWidth };
}

interface PosterGridStaticProps {
  columns: number;
  viewportWidth: number;
  itemCount: number;
  resolvedItems: (HubItemWithServer | undefined)[];
}

function PosterGridStatic({
  columns,
  viewportWidth,
  itemCount,
  resolvedItems,
}: PosterGridStaticProps) {
  const rowCount = Math.ceil(itemCount / columns);

  return (
    <>
      {Array.from({ length: rowCount }).map((_, rowIndex) => {
        const startIndex = rowIndex * columns;
        return (
          <PosterGridRow
            key={rowIndex}
            rowIndex={rowIndex}
            columns={columns}
            viewportWidth={viewportWidth}
            cellCount={Math.min(columns, itemCount - startIndex)}
            startIndex={startIndex}
            resolvedItems={resolvedItems}
          />
        );
      })}
    </>
  );
}

export function PosterGridSkeleton({ rows = 3 }: { rows?: number }) {
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerEl(node);
  }, []);
  const { columns, viewportWidth } = usePosterGridLayout(containerEl);
  const itemCount = rows * columns;
  const resolvedItems = useMemo(
    () => Array.from({ length: itemCount }, () => undefined),
    [itemCount],
  );

  return (
    <div ref={containerRef} className={POSTER_GRID_CONTAINER_CLASSNAME}>
      <PosterGridStatic
        columns={columns}
        viewportWidth={viewportWidth}
        itemCount={itemCount}
        resolvedItems={resolvedItems}
      />
    </div>
  );
}

const OVERSCAN_ROWS = 3;

const VirtualizedPosterGridRow = memo(function VirtualizedPosterGridRow({
  rowIndex,
  startIndex,
  cellCount,
  columns,
  viewportWidth,
  translateY,
  resolvedItems,
  measureElement,
}: {
  rowIndex: number;
  startIndex: number;
  cellCount: number;
  columns: number;
  viewportWidth: number;
  translateY: number;
  resolvedItems: (HubItemWithServer | undefined)[];
  measureElement: (element: Element | null) => void;
}) {
  return (
    <PosterGridRow
      rowIndex={rowIndex}
      columns={columns}
      viewportWidth={viewportWidth}
      cellCount={cellCount}
      startIndex={startIndex}
      resolvedItems={resolvedItems}
      measureElement={measureElement}
      className={`absolute top-0 left-0 w-full ${POSTER_GRID_ROW_CLASSNAME}`}
      style={{
        transform: `translateY(${translateY}px)`,
      }}
    />
  );
});

const EMPTY_PAGE_RESULT: PaginatedPosterResult = { items: [], totalSize: 0 };

/**
 * Windowed poster grid: the scrollbar reflects `totalSize` up front and
 * pages are fetched on demand for whichever offsets scroll into view, so
 * the user can jump anywhere in a large library.
 *
 * Render with a `key` derived from the content source (matching
 * `contentKey`) so navigating to different content remounts the grid.
 * Fetched pages live in the react-query cache keyed by `contentKey`, so
 * they survive the remount and navigating back is instant.
 */
export function MediaPosterGrid({
  contentKey,
  items,
  totalSize,
  pageSize,
  onLoadPage,
  emptyMessage = "No items found.",
}: MediaPosterGridProps) {
  // TanStack Virtual mutates the virtualizer instance in place, so the
  // React Compiler would cache getVirtualItems()/getTotalSize() against
  // the stable instance reference and never re-render on scroll. Opt this
  // component out until the virtualizer ships compiler support
  // (https://github.com/TanStack/virtual/issues/736).
  "use no memo";

  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerEl(node);
  }, []);
  const [scrollMargin, setScrollMargin] = useState<number | null>(null);
  const { columns, viewportWidth } = usePosterGridLayout(containerEl);

  useEffect(() => {
    const element = containerEl;
    if (!element) {
      return;
    }

    const measure = () => {
      setScrollMargin(element.getBoundingClientRect().top + window.scrollY);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerEl]);

  const estimatedRowHeight = getPosterGridRowHeightEstimate(viewportWidth);

  const [liveTotalSize, setLiveTotalSize] = useState<number | null>(null);

  const itemCount = onLoadPage
    ? (liveTotalSize ?? totalSize)
    : Math.min(totalSize, items.length);
  const safeColumns = columns;
  const rowCount = Math.ceil(itemCount / safeColumns);

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => estimatedRowHeight,
    overscan: OVERSCAN_ROWS,
    scrollMargin: scrollMargin ?? 0,
  });
  const virtualRows = virtualizer.getVirtualItems();

  const neededPagesKey = useMemo(() => {
    if (!onLoadPage) {
      return "";
    }
    const pages = new Set<number>();
    if (items.length < Math.min(pageSize, itemCount)) {
      pages.add(0);
    }
    for (const row of virtualRows) {
      const firstIndex = row.index * safeColumns;
      const lastIndex = Math.min(firstIndex + safeColumns - 1, itemCount - 1);
      const firstPage = Math.floor(firstIndex / pageSize);
      const lastPage = Math.floor(lastIndex / pageSize);
      for (let pageIndex = firstPage; pageIndex <= lastPage; pageIndex++) {
        if (pageIndex > 0) {
          pages.add(pageIndex);
        }
      }
    }
    return [...pages].sort((a, b) => a - b).join(",");
  }, [onLoadPage, items.length, pageSize, itemCount, virtualRows, safeColumns]);

  const neededPages = useMemo(
    () => (neededPagesKey === "" ? [] : neededPagesKey.split(",").map(Number)),
    [neededPagesKey],
  );

  const pageResults = useQueries({
    queries: neededPages.map((pageIndex) => ({
      queryKey: ["media-poster-grid", contentKey, pageSize, pageIndex],
      queryFn: async () => {
        const result = await onLoadPage?.({
          start: pageIndex * pageSize,
          size: pageSize,
        });
        return result ?? EMPTY_PAGE_RESULT;
      },
      staleTime: Infinity,
    })),
    combine: (results) => results.map((result) => result.data),
  });

  useEffect(() => {
    let latest: number | null = null;
    for (const result of pageResults) {
      if (result && result.items.length > 0) {
        latest = result.totalSize;
      }
    }
    if (latest !== null) {
      setLiveTotalSize(latest);
    }
  }, [pageResults]);

  const resolvedItems = useMemo(() => {
    const resolved: (HubItemWithServer | undefined)[] = new Array(
      itemCount,
    ) as (HubItemWithServer | undefined)[];
    for (let i = 0; i < Math.min(items.length, itemCount); i++) {
      resolved[i] = items[i];
    }
    neededPages.forEach((pageIndex, queryIndex) => {
      const result = pageResults[queryIndex];
      if (!result) {
        return;
      }
      const base = pageIndex * pageSize;
      for (let i = 0; i < result.items.length && base + i < itemCount; i++) {
        resolved[base + i] = result.items[i];
      }
    });
    return resolved;
  }, [items, neededPages, pageResults, pageSize, itemCount]);

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">{emptyMessage}</p>
    );
  }

  return (
    <div ref={containerRef} className={POSTER_GRID_CONTAINER_CLASSNAME}>
      {scrollMargin === null ? (
        <PosterGridStatic
          columns={columns}
          viewportWidth={viewportWidth}
          itemCount={items.length}
          resolvedItems={items}
        />
      ) : (
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualRows.map((virtualRow) => {
            const startIndex = virtualRow.index * columns;
            return (
              <VirtualizedPosterGridRow
                key={virtualRow.key}
                rowIndex={virtualRow.index}
                startIndex={startIndex}
                cellCount={Math.min(columns, itemCount - startIndex)}
                columns={columns}
                viewportWidth={viewportWidth}
                translateY={virtualRow.start - scrollMargin}
                resolvedItems={resolvedItems}
                measureElement={virtualizer.measureElement}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
