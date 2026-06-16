"use client";

import { useCallback } from "react";
import {
  isPlayablePosterItemType,
  toPlayableMetadata,
  type HubItemWithServer,
  type ItemMetadata,
} from "@multiplex/plex-query";
import { createMediaPlayerItem } from "~/lib/create-media-player-item";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import { api } from "~/trpc/react";

export function useHubItemPlayback(item: HubItemWithServer | undefined) {
  const openPlayer = useMediaPlayerStore((state) => state.openPlayer);
  const utils = api.useUtils();

  const canPlay = Boolean(
    item &&
      isPlayablePosterItemType(item.type) &&
      item.serverUrl &&
      item.authToken,
  );

  const play = useCallback(async () => {
    if (!item?.serverUrl || !item?.authToken) {
      return;
    }

    const playback = {
      serverId: item.serverId,
      serverUrl: item.serverUrl,
      authToken: item.authToken,
    };

    const inlinePlayable = toPlayableMetadata(item as unknown as ItemMetadata);
    if (inlinePlayable) {
      openPlayer(createMediaPlayerItem(inlinePlayable, playback));
      return;
    }

    const details = await utils.client.plex.getItemDetails.query({
      serverId: item.serverId,
      ratingKey: item.ratingKey,
    });

    if (details?.playTarget) {
      openPlayer(createMediaPlayerItem(details.playTarget, playback));
    }
  }, [item, openPlayer, utils]);

  return { canPlay, play };
}
