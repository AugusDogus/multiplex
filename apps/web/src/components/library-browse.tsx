"use client";

import { useEffect, useRef, useState } from "react";
import type { HubItemWithServer, HubWithServer } from "@multiplex/plex-query";
import { MediaHubRow, MediaHubRowSkeleton } from "~/components/media-hub-row";
import { MediaPosterCard } from "~/components/media-poster-card";
import { Skeleton } from "~/components/ui/skeleton";
import { api } from "~/trpc/react";

interface LibraryBrowseProps {
  machineIdentifier: string;
  sectionId: string;
  initialHubs: HubWithServer[];
  initialContent: {
    items: HubItemWithServer[];
    totalSize: number;
    offset: number;
    librarySectionTitle?: string;
  };
}

const PAGE_SIZE = 24;

export function LibraryBrowse({
  machineIdentifier,
  sectionId,
  initialHubs,
  initialContent,
}: LibraryBrowseProps) {
  const [allItems, setAllItems] = useState(initialContent.items);
  const [offset, setOffset] = useState(initialContent.items.length);
  const [hasMore, setHasMore] = useState(
    initialContent.items.length < initialContent.totalSize,
  );
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const { data: hubs, isLoading: hubsLoading } =
    api.plex.getLibraryHubs.useQuery(
      { machineIdentifier, sectionId },
      {
        initialData: initialHubs,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
      },
    );

  const loadMoreQuery = api.plex.getLibraryContent.useQuery(
    {
      machineIdentifier,
      sectionId,
      start: offset,
      size: PAGE_SIZE,
    },
    {
      enabled: false,
      staleTime: 2 * 60 * 1000,
    },
  );

  useEffect(() => {
    setAllItems(initialContent.items);
    setOffset(initialContent.items.length);
    setHasMore(initialContent.items.length < initialContent.totalSize);
  }, [initialContent, machineIdentifier, sectionId]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          !loadMoreQuery.isFetching &&
          hasMore
        ) {
          void loadMoreQuery.refetch().then((result) => {
            const newItems = result.data?.items ?? [];
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
            setOffset((current) => current + newItems.length);
            setHasMore(
              (result.data?.offset ?? 0) + newItems.length <
                (result.data?.totalSize ?? 0),
            );
          });
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadMoreQuery, loadMoreQuery.isFetching]);

  return (
    <div className="flex flex-col gap-8">
      {hubsLoading && hubs.length === 0 ? (
        <>
          <MediaHubRowSkeleton />
          <MediaHubRowSkeleton />
        </>
      ) : (
        hubs.map((hub) => (
          <MediaHubRow key={`${hub.serverId}-${hub.hubIdentifier}`} hub={hub} />
        ))
      )}

      <section className="flex flex-col gap-y-4">
        <div className="px-4 md:px-8">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
            All {initialContent.librarySectionTitle ?? "Titles"}
          </h2>
        </div>

        {allItems.length === 0 ? (
          <p className="text-muted-foreground px-4 text-sm md:px-8">
            No items found in this library.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-5 px-4 sm:grid-cols-3 sm:gap-x-4 md:grid-cols-4 md:px-8 lg:grid-cols-5 xl:grid-cols-6">
            {allItems.map((item) => (
              <MediaPosterCard
                key={`${item.serverId}-${item.ratingKey}`}
                item={item}
                layout="grid"
              />
            ))}
          </div>
        )}

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
      </section>
    </div>
  );
}
