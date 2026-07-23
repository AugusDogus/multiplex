"use client";

import { PlaylistItemRow } from "~/components/playlist/playlist-item-row";
import { Button } from "~/components/ui/button";
import type { RouterOutputs } from "~/trpc/api";

type PlaylistItem =
  RouterOutputs["plex"]["getPlaylistContents"]["items"][number];

interface PlaylistItemsSectionProps {
  items: PlaylistItem[];
  serverId: string;
  serverUrl: string | undefined;
  authToken: string | undefined;
  start: number;
  totalSize: number;
  pageSize: number;
  editable: boolean;
  busy: boolean;
  isError: boolean;
  isFetching: boolean;
  onRetry: () => void;
  onMove: (index: number, direction: "up" | "down") => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}

export function PlaylistItemsSection({
  items,
  serverId,
  serverUrl,
  authToken,
  start,
  totalSize,
  pageSize,
  editable,
  busy,
  isError,
  isFetching,
  onRetry,
  onMove,
  onPreviousPage,
  onNextPage,
}: PlaylistItemsSectionProps) {
  return (
    <>
      <section aria-label="Playlist contents" className="flex flex-col gap-2">
        {isError ? (
          <div className="rounded-lg border p-6 text-sm">
            <p className="text-destructive">Could not load playlist items.</p>
            <Button className="mt-3" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border p-6 text-sm">
            This playlist is empty.
          </p>
        ) : (
          items.map((item, index) => (
            <PlaylistItemRow
              key={String(item.playlistItemID ?? item.ratingKey)}
              item={item}
              serverId={serverId}
              serverUrl={serverUrl}
              authToken={authToken}
              index={index}
              start={start}
              totalSize={totalSize}
              editable={editable}
              busy={busy}
              onMove={onMove}
            />
          ))
        )}
      </section>

      {totalSize > pageSize && (
        <nav aria-label="Playlist pages" className="flex justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={start === 0 || isFetching}
            onClick={onPreviousPage}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={start + pageSize >= totalSize || isFetching}
            onClick={onNextPage}
          >
            Next
          </Button>
        </nav>
      )}
    </>
  );
}
