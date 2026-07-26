"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";

import { Button } from "~/components/ui/button";
import { getPlexImagePath } from "~/lib/plex-image";
import { getItemDetailsHref } from "~/lib/plex-routes";
import type { RouterOutputs } from "~/trpc/api";

type PlaylistItem =
  RouterOutputs["plex"]["getPlaylistContents"]["items"][number];

interface PlaylistItemRowProps {
  item: PlaylistItem;
  serverId: string;
  serverUrl: string | undefined;
  authToken: string | undefined;
  index: number;
  start: number;
  totalSize: number;
  editable: boolean;
  busy: boolean;
  onMove: (index: number, direction: "up" | "down") => void;
}

export function PlaylistItemRow({
  item,
  serverId,
  serverUrl,
  authToken,
  index,
  start,
  totalSize,
  editable,
  busy,
  onMove,
}: PlaylistItemRowProps) {
  const thumbnailUrl = getPlexImagePath(item.thumb, {
    width: 96,
    height: 144,
    serverUrl,
    authToken,
  });
  const canReorder = editable && item.playlistItemID !== undefined;

  return (
    <article className="bg-card flex items-center gap-3 rounded-lg border p-3">
      {thumbnailUrl ? (
        <Image
          src={thumbnailUrl}
          alt=""
          width={48}
          height={72}
          className="h-14 w-10 rounded object-cover"
        />
      ) : (
        <div className="bg-muted h-14 w-10 shrink-0 rounded" />
      )}

      <div className="min-w-0 flex-1">
        <Link
          href={getItemDetailsHref(serverId, item.type, item.ratingKey)}
          className="hover:underline"
        >
          <span className="line-clamp-1 font-medium">{item.title}</span>
        </Link>
        <p className="text-muted-foreground line-clamp-1 text-xs">
          {item.grandparentTitle ?? item.parentTitle ?? item.type}
        </p>
      </div>

      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={`Move ${item.title} up`}
          onClick={() => onMove(index, "up")}
          disabled={!canReorder || busy || start + index === 0}
        >
          <ArrowUp />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={`Move ${item.title} down`}
          onClick={() => onMove(index, "down")}
          disabled={!canReorder || busy || start + index >= totalSize - 1}
        >
          <ArrowDown />
        </Button>
      </div>
    </article>
  );
}
