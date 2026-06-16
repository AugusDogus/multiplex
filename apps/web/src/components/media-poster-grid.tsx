"use client";

import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { useQueries } from "@tanstack/react-query";
import type { HubItemWithServer } from "@multiplex/plex-query";
import { useAppScrollElement } from "~/components/app-scroll-container";
import { PosterGridRow } from "~/components/poster-grid-row";
import { PosterGridStatic } from "~/components/poster-grid-static";
import { usePosterGridLayout } from "~/hooks/use-poster-grid-layout";
import { useTanStackVirtualizer } from "~/hooks/use-tanstack-virtualizer";
import {
  POSTER_GRID_INSET_CLASSNAME,
  POSTER_GRID_ROW_CONTENT_HEIGHT_PX,
  POSTER_GRID_ROW_GAP_PX,
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

const OVERSCAN_ROWS = 3;

const VirtualizedPosterGridRow = memo(function VirtualizedPosterGridRow({
  rowIndex,
  startIndex,
  cellCount,
  columns,
  translateY,
  resolvedItems,
  measureElement,
}: {
  rowIndex: number;
  startIndex: number;
  cellCount: number;
  columns: number;
  translateY: number;
  resolvedItems: (HubItemWithServer | undefined)[];
  measureElement: (element: Element | null) => void;
}) {
  return (
    <PosterGridRow
      rowIndex={rowIndex}
      columnCount={columns}
      cellCount={cellCount}
      startIndex={startIndex}
      resolvedItems={resolvedItems}
      measureElement={measureElement}
      className="absolute top-0 left-0 w-full"
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
  const scrollElement = useAppScrollElement();
  const [scrollMargin, setScrollMargin] = useState<number | null>(null);
  const { columns, isReady } = usePosterGridLayout(containerEl);

  useLayoutEffect(() => {
    const element = containerEl;
    const scroller = scrollElement;
    if (!element || !scroller) {
      return;
    }

    const measure = () => {
      setScrollMargin(
        element.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    observer.observe(element);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [containerEl, scrollElement]);

  const itemCount = onLoadPage
    ? totalSize
    : Math.min(totalSize, items.length);
  const rowCount = isReady && columns > 0 ? Math.ceil(itemCount / columns) : 0;

  const virtualizer = useTanStackVirtualizer({
    count: rowCount,
    estimateSize: () => POSTER_GRID_ROW_CONTENT_HEIGHT_PX,
    gap: POSTER_GRID_ROW_GAP_PX,
    getItemKey: (index) => `${columns}-${index}`,
    getScrollElement: () => scrollElement,
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
      const firstIndex = row.index * columns;
      const lastIndex = Math.min(firstIndex + columns - 1, itemCount - 1);
      const firstPage = Math.floor(firstIndex / pageSize);
      const lastPage = Math.floor(lastIndex / pageSize);
      for (let pageIndex = firstPage; pageIndex <= lastPage; pageIndex++) {
        if (pageIndex > 0) {
          pages.add(pageIndex);
        }
      }
    }
    return [...pages].sort((a, b) => a - b).join(",");
  }, [onLoadPage, items.length, pageSize, itemCount, virtualRows, columns]);

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

  const resolvedItems = useMemo(() => {
    const resolved: (HubItemWithServer | undefined)[] = Array.from(
      { length: itemCount },
      () => undefined,
    );
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

  useLayoutEffect(() => {
    if (scrollMargin === null || !isReady || rowCount === 0) {
      return;
    }
    virtualizer.measure();
  }, [columns, scrollMargin, isReady, rowCount, virtualizer]);

  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;
  }

  return (
    <div
      ref={containerRef}
      className={`w-full min-w-0 ${POSTER_GRID_INSET_CLASSNAME}`}
    >
      {!isReady || scrollElement === null || scrollMargin === null ? (
        <PosterGridStatic items={items} />
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
