"use client";

import { useCallback } from "react";
import {
  MediaPosterGrid,
  type PaginatedPosterResult,
} from "~/components/media-poster-grid";

interface PaginatedPosterGridProps {
  initialContent: PaginatedPosterResult;
  pageSize: number;
  onLoadPage: (input: {
    start: number;
    size: number;
  }) => Promise<PaginatedPosterResult>;
  emptyMessage?: string;
}

export function PaginatedPosterGrid({
  initialContent,
  pageSize,
  onLoadPage,
  emptyMessage,
}: PaginatedPosterGridProps) {
  const onLoadMore = useCallback(
    async (start: number): Promise<PaginatedPosterResult | null> => {
      return onLoadPage({ start, size: pageSize });
    },
    [onLoadPage, pageSize],
  );

  return (
    <MediaPosterGrid
      items={initialContent.items}
      totalSize={initialContent.totalSize}
      onLoadMore={onLoadMore}
      emptyMessage={emptyMessage}
    />
  );
}
