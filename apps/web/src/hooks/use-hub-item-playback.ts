"use client";

import { useCallback } from "react";
import {
  isPlayablePosterItemType,
  toPlayableMetadata,
  type HubItemWithServer,
  type ItemMetadata,
} from "@multiplex/plex-query";
import { createMediaPlayerItem } from "~/lib/create-media-player-item";
import { playerCommands } from "~/lib/effect/player-atoms";
import { api } from "~/trpc/react";

let latestPlaybackIntent = 0;

export function useHubItemPlayback(item: HubItemWithServer | undefined) {
  const utils = api.useUtils();

  const canPlay = Boolean(
    item &&
      isPlayablePosterItemType(item.type) &&
      item.serverUrl &&
      item.authToken,
  );

  const play = useCallback(async () => {
    const playbackIntent = ++latestPlaybackIntent;

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
      playerCommands.openPlayer(
        createMediaPlayerItem(inlinePlayable, playback),
      );
      return;
    }

    const startingPlayback = playerCommands.playbackIdentity();
    const details = await utils.client.plex.getItemDetails.query({
      serverId: item.serverId,
      ratingKey: item.ratingKey,
    });

    const currentPlayback = playerCommands.playbackIdentity();
    if (
      playbackIntent !== latestPlaybackIntent ||
      currentPlayback?.streamSessionId !== startingPlayback?.streamSessionId ||
      currentPlayback?.serverId !== startingPlayback?.serverId ||
      currentPlayback?.ratingKey !== startingPlayback?.ratingKey
    ) {
      return;
    }

    if (details?.playTarget) {
      playerCommands.openPlayer(
        createMediaPlayerItem(details.playTarget, playback),
      );
    }
  }, [item, utils]);

  return { canPlay, play };
}
