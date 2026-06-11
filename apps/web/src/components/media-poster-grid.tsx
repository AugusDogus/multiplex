"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { HubItemWithServer } from "@multiplex/plex-query";
import { MediaPosterCard } from "~/components/media-poster-card";
import { Skeleton } from "~/components/ui/skeleton";

export const POSTER_GRID_CLASSNAME =
  "grid grid-cols-2 gap-x-3 gap-y-5 px-4 sm:grid-cols-3 sm:gap-x-4 md:grid-cols-4 md:px-8 lg:grid-cols-5 xl:grid-cols-6";

export const POSTER_GRID_LOADING_SKELETON_COUNT = 6;
export const POSTER_GRID_LOAD_MARGIN = "200px";

export interface PaginatedPosterResult {
  items: HubItemWithServer[];
  totalSize: number;
  offset: number;
}

interface MediaPosterGridProps {
  items: HubItemWithServer[];
  totalSize: number;
  onLoadMore?: (start: number) => Promise<PaginatedPosterResult | null>;
  emptyMessage?: string;
}

/**
 * Render with a `key` derived from the content source (e.g. section or hub
 * id) so navigating to different content remounts the grid. The remount
 * resets the loaded pages and makes any in-flight page load from the
 * previous content a no-op.
 */
export function MediaPosterGrid({
  items,
  totalSize,
  onLoadMore,
  emptyMessage = "No items found.",
}: MediaPosterGridProps) {
  const [loadedItems, setLoadedItems] = useState<HubItemWithServer[]>([]);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const allItems = useMemo(() => {
    const seen = new Set<string>();
    const merged: HubItemWithServer[] = [];
    for (const item of [...items, ...loadedItems]) {
      if (!seen.has(item.ratingKey)) {
        seen.add(item.ratingKey);
        merged.push(item);
      }
    }
    return merged;
  }, [items, loadedItems]);

  const hasMore =
    Boolean(onLoadMore) && !reachedEnd && allItems.length < totalSize;

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore || !onLoadMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isLoadingMore) {
          setIsLoadingMore(true);
          void onLoadMore(allItems.length)
            .then((result) => {
              if (!result || result.items.length === 0) {
                setReachedEnd(true);
                return;
              }

              // A page of only duplicates means the next start offset would
              // never advance; stop instead of refetching the same page.
              const existingKeys = new Set(
                allItems.map((item) => item.ratingKey),
              );
              if (
                result.items.every((item) => existingKeys.has(item.ratingKey))
              ) {
                setReachedEnd(true);
                return;
              }

              setLoadedItems((current) => [...current, ...result.items]);
              if (result.offset + result.items.length >= result.totalSize) {
                setReachedEnd(true);
              }
            })
            .finally(() => setIsLoadingMore(false));
        }
      },
      { rootMargin: POSTER_GRID_LOAD_MARGIN },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [allItems, hasMore, isLoadingMore, onLoadMore]);

  if (allItems.length === 0) {
    return (
      <p className="text-muted-foreground px-4 text-sm md:px-8">
        {emptyMessage}
      </p>
    );
  }

  return (
    <>
      <div className={POSTER_GRID_CLASSNAME}>
        {allItems.map((item) => (
          <MediaPosterCard
            key={`${item.serverId}-${item.ratingKey}`}
            item={item}
            layout="grid"
          />
        ))}
      </div>

      {hasMore && (
        <div ref={loadMoreRef} className="px-4 pb-4 md:px-8">
          <div className={POSTER_GRID_CLASSNAME}>
            {Array.from({ length: POSTER_GRID_LOADING_SKELETON_COUNT }).map(
              (_, index) => (
                <div key={index} className="flex flex-col gap-2">
                  <Skeleton className="aspect-[2/3] w-full rounded-md" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ),
            )}
          </div>
        </div>
      )}
    </>
  );
}
