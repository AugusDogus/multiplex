"use client";

import { useCallback, useContext } from "react";
import { RegistryContext } from "@effect/atom-react";
import {
  isPlayablePosterItemType,
  toPlayableMetadata,
  type HubItemWithServer,
  type ItemMetadata,
} from "@multiplex/plex-query";
import { Effect } from "effect";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { createMediaPlayerItem } from "~/lib/create-media-player-item";
import { playerCommands } from "~/lib/effect/player-atoms";
import { itemDetailsAtom } from "~/lib/effect/plex-atoms";

export function useHubItemPlayback(item: HubItemWithServer | undefined) {
  const registry = useContext(RegistryContext);

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
      playerCommands.openPlayer(
        createMediaPlayerItem(inlinePlayable, playback),
      );
      return;
    }

    const detailsAtom = itemDetailsAtom({
      serverId: item.serverId,
      ratingKey: item.ratingKey,
    });
    const unmount = registry.mount(detailsAtom);
    try {
      const details = await Effect.runPromise(
        AtomRegistry.getResult(registry, detailsAtom, {
          suspendOnWaiting: true,
        }),
      );
      if (details?.playTarget) {
        playerCommands.openPlayer(
          createMediaPlayerItem(details.playTarget, playback),
        );
      }
    } finally {
      unmount();
    }
  }, [item, registry]);

  return { canPlay, play };
}
