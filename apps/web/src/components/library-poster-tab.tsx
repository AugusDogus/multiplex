"use client";

import type { HubItemWithServer } from "@multiplex/plex-query";
import { MediaPosterGrid } from "~/components/media-poster-grid";
import { LIBRARY_PAGE_SIZE } from "~/server/queries/plex-pagination";
import { api } from "~/trpc/api";

type PosterTabKind = "collections" | "playlists";

const EMPTY_MESSAGES = {
  collections: "No collections in this library.",
  playlists: "No playlists in this library.",
} satisfies Record<PosterTabKind, string>;

interface LibraryPosterTabProps {
  kind: PosterTabKind;
  machineIdentifier: string;
  sectionId: string;
  initialContent: {
    items: HubItemWithServer[];
    totalSize: number;
    offset: number;
  };
}

/**
 * Paginated poster grid for the Collections and Playlists tabs, which share an
 * identical shape and differ only in which tRPC procedure loads further pages.
 */
export function LibraryPosterTab({
  kind,
  machineIdentifier,
  sectionId,
  initialContent,
}: LibraryPosterTabProps) {
  const utils = api.useUtils();

  const onLoadPage = (input: { start: number; size: number }) => {
    const procedure =
      kind === "collections"
        ? utils.client.plex.getLibraryCollections
        : utils.client.plex.getLibraryPlaylists;
    return procedure.query({
      machineIdentifier,
      sectionId,
      start: input.start,
      size: input.size,
    });
  };

  const contentKey = `${machineIdentifier}-${sectionId}-${kind}`;

  return (
    <MediaPosterGrid
      key={contentKey}
      contentKey={contentKey}
      items={initialContent.items}
      totalSize={initialContent.totalSize}
      pageSize={LIBRARY_PAGE_SIZE}
      onLoadPage={onLoadPage}
      emptyMessage={EMPTY_MESSAGES[kind]}
    />
  );
}
