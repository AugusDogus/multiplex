"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { HubWithServer } from "@multiplex/plex-query";
import { MediaCarousel } from "~/components/media-carousel";
import { MediaCarouselSkeleton } from "~/components/media-carousel-skeleton";
import { MediaPosterCard } from "~/components/media-poster-card";
import { getHubHref } from "~/lib/plex-routes";

interface MediaHubRowProps {
  hub: HubWithServer;
}

function isHubNavigable(hub: HubWithServer): boolean {
  if (!hub.key || hub.items.length === 0) {
    return false;
  }

  return hub.more === true || hub.size > hub.items.length;
}

export function MediaHubRow({ hub }: MediaHubRowProps) {
  if (hub.items.length === 0) {
    return null;
  }

  const navigable = isHubNavigable(hub);
  const hubHref = navigable
    ? getHubHref(hub.serverId, hub.key, hub.title)
    : undefined;

  const header = hubHref ? (
    <Link
      href={hubHref}
      className="group -my-2 inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm py-2 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
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
  );

  return (
    <MediaCarousel header={header} gapClassName="gap-3 sm:gap-4">
      {hub.items.map((item) => (
        <MediaPosterCard
          key={`${item.serverId}-${item.ratingKey}`}
          item={item}
        />
      ))}
    </MediaCarousel>
  );
}

export function MediaHubRowSkeleton() {
  return <MediaCarouselSkeleton />;
}
