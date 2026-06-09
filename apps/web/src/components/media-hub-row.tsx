"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { HubWithServer } from "@multiplex/plex-query";
import { MediaPosterCard } from "~/components/media-poster-card";
import { Skeleton } from "~/components/ui/skeleton";
import { getHubHref } from "~/lib/plex-routes";

interface MediaHubRowProps {
  hub: HubWithServer;
}

function isHubNavigable(hub: HubWithServer): boolean {
  return Boolean(
    hub.key &&
      hub.items.length > 0 &&
      (hub.more ?? hub.size > hub.items.length),
  );
}

export function MediaHubRow({ hub }: MediaHubRowProps) {
  if (hub.items.length === 0) {
    return null;
  }

  const navigable = isHubNavigable(hub);
  const hubHref = navigable
    ? getHubHref(hub.serverId, hub.key, hub.title)
    : undefined;

  return (
    <section className="flex flex-col gap-y-4">
      <div className="flex items-center justify-between px-4 md:px-8">
        {hubHref ? (
          <Link
            href={hubHref}
            className="group -my-2 flex min-w-0 items-center gap-1 rounded-sm py-2 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <h2 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
              {hub.title}
            </h2>
            <ChevronRight className="text-muted-foreground size-5 shrink-0 transition-transform group-hover:translate-x-0.5 group-active:translate-x-1" />
          </Link>
        ) : (
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {hub.title}
          </h2>
        )}
      </div>
      <div className="w-full max-w-full overflow-hidden">
        <div className="scrollbar-hide flex gap-3 overflow-x-auto px-4 pb-4 sm:gap-4 md:px-8">
          {hub.items.map((item) => (
            <MediaPosterCard
              key={`${item.serverId}-${item.ratingKey}`}
              item={item}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export function MediaHubRowSkeleton() {
  return (
    <section className="flex flex-col gap-y-4">
      <div className="px-4 md:px-8">
        <Skeleton className="h-7 w-48" />
      </div>
      <div className="scrollbar-hide flex gap-3 overflow-x-auto px-4 pb-4 sm:gap-4 md:px-8">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex shrink-0 flex-col gap-2">
            <Skeleton className="h-[180px] w-[120px] rounded-md sm:h-[210px] sm:w-[140px] md:h-[240px] md:w-[160px]" />
            <Skeleton className="h-4 w-[120px] sm:w-[140px] md:w-[160px]" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
    </section>
  );
}
