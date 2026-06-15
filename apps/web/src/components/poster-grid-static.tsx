"use client";

import type { HubItemWithServer } from "@multiplex/plex-query";

import { MediaPosterCard } from "~/components/media-poster-card";
import { PosterGridStaticLayout } from "~/components/poster-grid-static-layout";

interface PosterGridStaticProps {
  items: HubItemWithServer[];
}

export function PosterGridStatic({ items }: PosterGridStaticProps) {
  return (
    <PosterGridStaticLayout>
      {items.map((item) => (
        <MediaPosterCard
          key={`${item.serverId}-${item.ratingKey}`}
          item={item}
        />
      ))}
    </PosterGridStaticLayout>
  );
}
