"use client";

import type { CSSProperties } from "react";
import type { HubItemWithServer } from "@multiplex/plex-query";

import { MediaPosterCard } from "~/components/media-poster-card";
import { PosterCardSkeleton } from "~/components/poster-card-skeleton";
import { getPosterGridTemplateColumns } from "~/lib/poster-grid-layout";
import { cn } from "~/lib/utils";

function PosterGridCell({ item }: { item?: HubItemWithServer }) {
  if (item) {
    return <MediaPosterCard item={item} />;
  }

  return <PosterCardSkeleton />;
}

export interface PosterGridRowProps {
  columnCount: number;
  viewportWidth: number;
  cellCount: number;
  startIndex: number;
  resolvedItems: (HubItemWithServer | undefined)[];
  className?: string;
  style?: CSSProperties;
  measureElement?: (element: Element | null) => void;
  rowIndex?: number;
}

export function PosterGridRow({
  columnCount,
  viewportWidth,
  cellCount,
  startIndex,
  resolvedItems,
  className,
  style,
  measureElement,
  rowIndex,
}: PosterGridRowProps) {
  return (
    <div
      data-index={rowIndex}
      ref={measureElement}
      className={cn("grid justify-items-center gap-x-3 sm:gap-x-4", className)}
      style={{
        gridTemplateColumns: getPosterGridTemplateColumns(
          columnCount,
          viewportWidth,
        ),
        ...style,
      }}
    >
      {Array.from({ length: cellCount }, (_, column) => {
        const item = resolvedItems[startIndex + column];
        return item ? (
          <PosterGridCell
            key={`${item.serverId}-${item.ratingKey}`}
            item={item}
          />
        ) : (
          <PosterGridCell key={`skeleton-${startIndex + column}`} />
        );
      })}
    </div>
  );
}
