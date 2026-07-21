"use client";

import { useLayoutEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type { HubItemWithServer } from "@multiplex/plex-query";
import { useAppScrollElement } from "~/components/app-scroll-container";
import { PosterGridRow } from "~/components/poster-grid-row";
import { PosterGridStatic } from "~/components/poster-grid-static";
import { usePosterGridLayout } from "~/hooks/use-poster-grid-layout";
import {
  POSTER_GRID_INSET_CLASSNAME,
  POSTER_GRID_ROW_CONTENT_HEIGHT_PX,
  POSTER_GRID_ROW_GAP_PX,
} from "~/lib/poster-grid-layout";
import {
  browsePageRowKey,
  getActiveSyncEngineCollections,
  toHubItemsWithServer,
  writeBrowsePage,
} from "~/lib/sync-engine";

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
const POSTER_GRID_ROW_SIZE_PX =
  POSTER_GRID_ROW_CONTENT_HEIGHT_PX + POSTER_GRID_ROW_GAP_PX;

interface VirtualPosterRow {
  index: number;
  key: string;
  start: number;
}

function VirtualizedPosterGridRow({
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
}

const EMPTY_PAGE_RESULT: PaginatedPosterResult = { items: [], totalSize: 0 };

function getVirtualTotalSize(rowCount: number): number {
  if (rowCount <= 0) {
    return 0;
  }

  return (
    rowCount * POSTER_GRID_ROW_CONTENT_HEIGHT_PX +
    (rowCount - 1) * POSTER_GRID_ROW_GAP_PX
  );
}

function ignoreElementMeasurement() {
  return undefined;
}

function getVirtualRows({
  columns,
  rowCount,
  scrollHeight,
  scrollMargin,
  scrollTop,
}: {
  columns: number;
  rowCount: number;
  scrollHeight: number;
  scrollMargin: number;
  scrollTop: number;
}): VirtualPosterRow[] {
  if (rowCount === 0 || scrollHeight === 0) {
    return [];
  }

  const viewportTop = Math.max(0, scrollTop - scrollMargin);
  const viewportBottom = viewportTop + scrollHeight;
  const startIndex = Math.max(
    0,
    Math.floor(viewportTop / POSTER_GRID_ROW_SIZE_PX) - OVERSCAN_ROWS,
  );
  const endIndex = Math.min(
    rowCount - 1,
    Math.ceil(viewportBottom / POSTER_GRID_ROW_SIZE_PX) + OVERSCAN_ROWS,
  );
  const rows: VirtualPosterRow[] = [];

  for (let index = startIndex; index <= endIndex; index++) {
    rows.push({
      index,
      key: `${columns}-${index}`,
      start: index * POSTER_GRID_ROW_SIZE_PX,
    });
  }

  return rows;
}

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
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const containerRef = (node: HTMLDivElement | null) => {
    setContainerEl(node);
  };
  const scrollElement = useAppScrollElement();
  const [scrollMargin, setScrollMargin] = useState<number | null>(null);
  const [scrollState, setScrollState] = useState({ height: 0, top: 0 });
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

  const itemCount = onLoadPage ? totalSize : Math.min(totalSize, items.length);
  const rowCount = isReady && columns > 0 ? Math.ceil(itemCount / columns) : 0;
  useLayoutEffect(() => {
    if (!scrollElement) {
      return;
    }

    let frame: number | null = null;
    const update = () => {
      frame = null;
      setScrollState({
        height: scrollElement.clientHeight,
        top: scrollElement.scrollTop,
      });
    };
    const scheduleUpdate = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(update);
    };

    scheduleUpdate();
    scrollElement.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(scrollElement);

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
      scrollElement.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [scrollElement]);

  const virtualRows = getVirtualRows({
    columns,
    rowCount,
    scrollHeight: scrollState.height,
    scrollMargin: scrollMargin ?? 0,
    scrollTop: scrollState.top,
  });

  const neededPagesKey = (() => {
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
  })();

  const neededPages =
    neededPagesKey === "" ? [] : neededPagesKey.split(",").map(Number);

  const pageResults = useQueries({
    queries: neededPages.map((pageIndex) => ({
      queryKey: ["media-poster-grid", contentKey, pageSize, pageIndex],
      queryFn: async () => {
        const collections = getActiveSyncEngineCollections();
        const cached = collections?.browsePages.get(
          browsePageRowKey(contentKey, pageSize, pageIndex),
        );
        if (cached) {
          return {
            items: toHubItemsWithServer(cached),
            totalSize: cached.totalSize,
          };
        }

        const result = await onLoadPage?.({
          start: pageIndex * pageSize,
          size: pageSize,
        });
        const page = result ?? EMPTY_PAGE_RESULT;
        if (collections && page.items.length > 0) {
          writeBrowsePage(collections, {
            contentKey,
            pageSize,
            pageIndex,
            totalSize: page.totalSize,
            items: page.items as unknown as Array<Record<string, unknown>>,
          });
        }
        return page;
      },
      staleTime: Infinity,
    })),
    combine: (results) => results.map((result) => result.data),
  });

  // Persist the RSC-provided first page into the durable replica.
  useLayoutEffect(() => {
    const collections = getActiveSyncEngineCollections();
    if (!collections || items.length === 0) return;
    writeBrowsePage(collections, {
      contentKey,
      pageSize,
      pageIndex: 0,
      totalSize,
      items: items as unknown as Array<Record<string, unknown>>,
    });
  }, [contentKey, items, pageSize, totalSize]);

  const resolvedItems = (() => {
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
  })();

  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;
  }

  return (
    <div
      ref={containerRef}
      className={`w-full min-w-0 ${POSTER_GRID_INSET_CLASSNAME}`}
    >
      {!isReady ||
      scrollElement === null ||
      scrollMargin === null ||
      scrollState.height === 0 ? (
        <PosterGridStatic items={items} />
      ) : (
        <div
          className="relative w-full"
          style={{ height: getVirtualTotalSize(rowCount) }}
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
                translateY={virtualRow.start}
                resolvedItems={resolvedItems}
                measureElement={ignoreElementMeasurement}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
