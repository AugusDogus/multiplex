"use client";

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQueries } from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { HubItemWithServer } from "@multiplex/plex-query";
import { MediaPosterCard } from "~/components/media-poster-card";
import { Skeleton } from "~/components/ui/skeleton";

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

/* Single source of truth for responsive columns: each entry pairs the
   matchMedia query with its Tailwind class literal (the scanner only
   needs the literal to appear in source). Ordered widest-first so the
   first match wins in getColumnsSnapshot. */
const GRID_COLUMN_BREAKPOINTS = [
  { query: "(min-width: 1280px)", columns: 6, className: "xl:grid-cols-6" },
  { query: "(min-width: 1024px)", columns: 5, className: "lg:grid-cols-5" },
  { query: "(min-width: 768px)", columns: 4, className: "md:grid-cols-4" },
  { query: "(min-width: 640px)", columns: 3, className: "sm:grid-cols-3" },
] as const;

const DEFAULT_COLUMNS = 2;

const GRID_ROW_CLASSNAME = [
  "grid grid-cols-2 gap-x-3 pb-5 sm:gap-x-4",
  ...GRID_COLUMN_BREAKPOINTS.map(({ className }) => className),
].join(" ");

const ESTIMATED_ROW_HEIGHT = 320;
const OVERSCAN_ROWS = 3;

function subscribeToBreakpoints(onChange: () => void) {
  const queryLists = GRID_COLUMN_BREAKPOINTS.map(({ query }) =>
    window.matchMedia(query),
  );
  for (const list of queryLists) {
    list.addEventListener("change", onChange);
  }
  return () => {
    for (const list of queryLists) {
      list.removeEventListener("change", onChange);
    }
  };
}

function getColumnsSnapshot() {
  for (const { query, columns } of GRID_COLUMN_BREAKPOINTS) {
    if (window.matchMedia(query).matches) {
      return columns;
    }
  }
  return DEFAULT_COLUMNS;
}

function useGridColumns() {
  return useSyncExternalStore(
    subscribeToBreakpoints,
    getColumnsSnapshot,
    () => DEFAULT_COLUMNS,
  );
}

function PosterSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="aspect-[2/3] w-full rounded-md" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

interface GridRowProps {
  rowIndex: number;
  startIndex: number;
  cellCount: number;
  translateY: number;
  /** Sparse array of all resolved items; identity changes only when pages load. */
  resolvedItems: (HubItemWithServer | undefined)[];
  measureElement: (element: Element | null) => void;
}

// Manually memoized (not compiler-memoized) because MediaPosterGrid opts
// out of the React Compiler via "use no memo"; without this every visible
// row would re-render on each scroll frame.
const GridRow = memo(function GridRow({
  rowIndex,
  startIndex,
  cellCount,
  translateY,
  resolvedItems,
  measureElement,
}: GridRowProps) {
  return (
    <div
      data-index={rowIndex}
      ref={measureElement}
      className={`absolute top-0 left-0 w-full ${GRID_ROW_CLASSNAME}`}
      style={{ transform: `translateY(${translateY}px)` }}
    >
      {Array.from({ length: cellCount }, (_, column) => {
        const item = resolvedItems[startIndex + column];
        return item ? (
          <MediaPosterCard key={column} item={item} layout="grid" />
        ) : (
          <PosterSkeleton key={column} />
        );
      })}
    </div>
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

  const columns = useGridColumns();
  const listRef = useRef<HTMLDivElement>(null);

  // Measured in an effect instead of reading offsetTop during render,
  // which would force a synchronous reflow on every scroll-driven
  // re-render. Null doubles as "not yet mounted". Content above the grid
  // (e.g. hub rows) can change height after mount, so re-measure whenever
  // the page layout shifts.
  const [scrollMargin, setScrollMargin] = useState<number | null>(null);
  useEffect(() => {
    const element = listRef.current;
    if (!element) {
      return;
    }
    const measure = () => {
      setScrollMargin(element.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);

  // Plex reports the live total with every page; adopt it so the grid
  // tracks libraries that grow or shrink between the SSR fetch and later
  // page loads (otherwise trailing rows would sit as skeletons forever).
  const [liveTotalSize, setLiveTotalSize] = useState<number | null>(null);

  // Without a page loader we can only ever show what we were given.
  const itemCount = onLoadPage
    ? (liveTotalSize ?? totalSize)
    : Math.min(totalSize, items.length);
  const rowCount = Math.ceil(itemCount / columns);

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
    scrollMargin: scrollMargin ?? 0,
  });
  const virtualRows = virtualizer.getVirtualItems();

  // Pages needed to cover the visible rows. Derived through a string key
  // so the array identity is stable across renders where the visible page
  // set hasn't changed.
  const neededPagesKey = useMemo(() => {
    if (!onLoadPage) {
      return "";
    }
    const pages = new Set<number>();
    // Page 0 comes from props, unless the server handed us a partial
    // first page.
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

  // react-query owns caching, in-flight dedup, retries, and error state.
  // Failed pages render as skeletons and refetch when scrolled back into
  // view; cached pages never refetch for the lifetime of the cache entry.
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
      // Ignore empty pages: the server swallows upstream errors into an
      // empty result whose totalSize of 0 would collapse the whole grid.
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
      <p className="text-muted-foreground px-4 text-sm md:px-8">
        {emptyMessage}
      </p>
    );
  }

  // Server render and hydration show the first page statically; the
  // virtualizer takes over once mounted and the scroll margin is measured.
  if (scrollMargin === null) {
    return (
      <div ref={listRef} className="px-4 md:px-8">
        <div className={GRID_ROW_CLASSNAME}>
          {items.map((item) => (
            <MediaPosterCard
              key={`${item.serverId}-${item.ratingKey}`}
              item={item}
              layout="grid"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={listRef} className="px-4 md:px-8">
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualRows.map((virtualRow) => {
          const startIndex = virtualRow.index * columns;
          return (
            <GridRow
              key={virtualRow.key}
              rowIndex={virtualRow.index}
              startIndex={startIndex}
              cellCount={Math.min(columns, itemCount - startIndex)}
              translateY={virtualRow.start - scrollMargin}
              resolvedItems={resolvedItems}
              measureElement={virtualizer.measureElement}
            />
          );
        })}
      </div>
    </div>
  );
}
