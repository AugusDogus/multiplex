import type { PlayableMetadata } from "@multiplex/plex-query";
import { getProgressPercent } from "@multiplex/plex-query";

import type { MediaPlayerItem } from "~/types/media-player";

export function createMediaPlayerItem(
  metadata: PlayableMetadata,
  playback: {
    serverId: string;
    serverUrl: string;
    authToken: string;
  },
): MediaPlayerItem {
  const { viewOffset, duration } = metadata;

  return {
    ...metadata,
    hubTitle: metadata.librarySectionTitle,
    hubType: "metadata",
    serverId: playback.serverId,
    serverUrl: playback.serverUrl,
    authToken: playback.authToken,
    progressPercent:
      viewOffset && duration ? getProgressPercent(metadata) : undefined,
    isCompleted: Boolean(metadata.viewCount),
    timeRemaining: viewOffset && duration ? duration - viewOffset : undefined,
  };
}
