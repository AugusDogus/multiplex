"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
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

/** Module-level page cache so remounts (same `contentKey`) stay instant. */
const posterPageCache = new Map<string, PaginatedPosterResult>();

function posterPageCacheKey(
  contentKey: string,
  pageSize: number,
  pageIndex: number,
): string {
  return `${contentKey}\0${pageSize}\0${pageIndex}`;
}

interface VirtualPosterRow {
  index: number;
  key: string;
  start: number;
}

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

function getVirtualTotalSize(rowCount: number): number {
  if (rowCount <= 0) {
    return 0;
  }

  return (
    rowCount * POSTER_GRID_ROW_CONTENT_HEIGHT_PX +
    (rowCount - 1) * POSTER_GRID_ROW_GAP_PX
  );
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
 * Fetched pages live in a module-level cache keyed by `contentKey`, so
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
  // Custom scroll virtualization mutates measured layout in place; keep the
  // compiler from caching scroll-derived values against stable refs.
  "use no memo";

  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerEl(node);
  }, []);
  const scrollElement = useAppScrollElement();
  const [scrollMargin, setScrollMargin] = useState<number | null>(null);
  const [scrollState, setScrollState] = useState({ height: 0, top: 0 });
  const { columns, isReady } = usePosterGridLayout(containerEl);
  /** Bumps when the module-level page cache gains entries for this grid. */
  const [pageCacheVersion, setPageCacheVersion] = useState(0);

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
  const measureElement = useCallback(() => undefined, []);

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

  const virtualRows = useMemo(
    () =>
      getVirtualRows({
        columns,
        rowCount,
        scrollHeight: scrollState.height,
        scrollMargin: scrollMargin ?? 0,
        scrollTop: scrollState.top,
      }),
    [columns, rowCount, scrollMargin, scrollState],
  );

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

  const pageResults = useMemo(() => {
    void pageCacheVersion;
    const results: Record<number, PaginatedPosterResult> = {};
    for (const pageIndex of neededPages) {
      const cached = posterPageCache.get(
        posterPageCacheKey(contentKey, pageSize, pageIndex),
      );
      if (cached) {
        results[pageIndex] = cached;
      }
    }
    return results;
  }, [neededPages, contentKey, pageSize, pageCacheVersion]);

  useEffect(() => {
    if (!onLoadPage || neededPages.length === 0) {
      return;
    }

    let cancelled = false;
    const loadPage = onLoadPage;

    for (const pageIndex of neededPages) {
      const cacheKey = posterPageCacheKey(contentKey, pageSize, pageIndex);
      if (posterPageCache.has(cacheKey)) {
        continue;
      }

      void loadPage({
        start: pageIndex * pageSize,
        size: pageSize,
      }).then((result) => {
        if (cancelled) {
          return;
        }
        posterPageCache.set(cacheKey, result ?? EMPTY_PAGE_RESULT);
        setPageCacheVersion((version) => version + 1);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [neededPages, contentKey, pageSize, onLoadPage]);

  const resolvedItems = useMemo(() => {
    const resolved: (HubItemWithServer | undefined)[] = Array.from(
      { length: itemCount },
      () => undefined,
    );
    for (let i = 0; i < Math.min(items.length, itemCount); i++) {
      resolved[i] = items[i];
    }
    for (const pageIndex of neededPages) {
      const result = pageResults[pageIndex];
      if (!result) {
        continue;
      }
      const base = pageIndex * pageSize;
      for (let i = 0; i < result.items.length && base + i < itemCount; i++) {
        resolved[base + i] = result.items[i];
      }
    }
    return resolved;
  }, [items, neededPages, pageResults, pageSize, itemCount]);

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
                measureElement={measureElement}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
