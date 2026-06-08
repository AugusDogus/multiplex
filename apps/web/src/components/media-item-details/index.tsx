"use client";

import type { PlayableMetadata } from "@multiplex/plex-query";

import { createMediaPlayerItem } from "~/lib/create-media-player-item";
import { useMediaPlayerStore } from "~/stores/media-player-store";

import { CastGrid } from "./cast-grid";
import { DetailsHero } from "./details-hero";
import { ItemChildren } from "./item-children";
import { TechnicalDetails } from "./technical-details";
import type { MediaItemDetailsProps } from "./types";

export function MediaItemDetails({ details, serverId }: MediaItemDetailsProps) {
  const openPlayer = useMediaPlayerStore((state) => state.openPlayer);
  const {
    item,
    children,
    playableChildren,
    playTarget,
    serverUrl,
    authToken,
    serverName,
  } = details;

  const openForPlayback = (source: PlayableMetadata) => {
    if (!serverUrl || !authToken) {
      return;
    }

    openPlayer(
      createMediaPlayerItem(source, {
        serverId,
        serverUrl,
        authToken,
      }),
    );
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-8 pb-24 md:pb-8">
      <DetailsHero
        item={item}
        serverId={serverId}
        serverName={serverName}
        serverUrl={serverUrl}
        authToken={authToken}
        playTarget={playTarget}
        onPlay={openForPlayback}
      />
      <TechnicalDetails item={item} />
      <ItemChildren
        itemType={item.type}
        childItems={children}
        playableChildren={playableChildren}
        serverId={serverId}
        serverUrl={serverUrl ?? undefined}
        authToken={authToken ?? undefined}
        onPlay={openForPlayback}
      />
      <CastGrid
        item={item}
        serverUrl={serverUrl ?? undefined}
        authToken={authToken ?? undefined}
      />
    </div>
  );
}

export type { ItemDetails, MediaItemDetailsProps } from "./types";
