"use client";

import type { HubItemWithServer } from "@multiplex/plex-query";

import { MediaPosterCard } from "~/components/media-poster-card";
import { POSTER_GRID_STATIC_CLASSNAME } from "~/lib/poster-grid-layout";

interface PosterGridStaticProps {
  items: HubItemWithServer[];
}

export function PosterGridStatic({ items }: PosterGridStaticProps) {
  return (
    <div className={POSTER_GRID_STATIC_CLASSNAME}>
      {items.map((item) => (
        <MediaPosterCard
          key={`${item.serverId}-${item.ratingKey}`}
          item={item}
        />
      ))}
    </div>
  );
}
