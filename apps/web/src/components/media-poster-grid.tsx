"use client";

import { useEffect, useRef, useState } from "react";
import type { HubItemWithServer } from "@multiplex/plex-query";
import { MediaPosterCard } from "~/components/media-poster-card";
import { Skeleton } from "~/components/ui/skeleton";

interface MediaPosterGridProps {
  items: HubItemWithServer[];
  totalSize: number;
  onLoadMore?: (start: number) => Promise<{
    items: HubItemWithServer[];
    totalSize: number;
    offset: number;
  } | null>;
  emptyMessage?: string;
}

export function MediaPosterGrid({
  items: initialItems,
  totalSize: initialTotalSize,
  onLoadMore,
  emptyMessage = "No items found.",
}: MediaPosterGridProps) {
  const [allItems, setAllItems] = useState(initialItems);
  const [hasMore, setHasMore] = useState(
    initialItems.length < initialTotalSize,
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAllItems(initialItems);
    setHasMore(initialItems.length < initialTotalSize);
  }, [initialItems, initialTotalSize]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore || !onLoadMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isLoadingMore && hasMore) {
          setIsLoadingMore(true);
          void onLoadMore(allItems.length)
            .then((result) => {
              if (!result) {
                setHasMore(false);
                return;
              }

              const newItems = result.items;
              if (newItems.length === 0) {
                setHasMore(false);
                return;
              }

              setAllItems((current) => {
                const existingKeys = new Set(
                  current.map((item) => item.ratingKey),
                );
                const uniqueNewItems = newItems.filter(
                  (item) => !existingKeys.has(item.ratingKey),
                );
                return [...current, ...uniqueNewItems];
              });
              setHasMore(result.offset + newItems.length < result.totalSize);
            })
            .finally(() => setIsLoadingMore(false));
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [allItems.length, hasMore, isLoadingMore, onLoadMore]);

  if (allItems.length === 0) {
    return (
      <p className="text-muted-foreground px-4 text-sm md:px-8">
        {emptyMessage}
      </p>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-x-3 gap-y-5 px-4 sm:grid-cols-3 sm:gap-x-4 md:grid-cols-4 md:px-8 lg:grid-cols-5 xl:grid-cols-6">
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
          <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 sm:gap-x-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex flex-col gap-2">
                <Skeleton className="aspect-[2/3] w-full rounded-md" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
