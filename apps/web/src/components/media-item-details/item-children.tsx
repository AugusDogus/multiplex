import type { ItemMetadata } from "@multiplex/plex-query";

import { EpisodeGrid } from "./episode-grid";
import { SeasonGrid } from "./season-grid";
import type {
  EnrichedChildMetadata,
  MediaServerContext,
  PlayableChildMetadata,
} from "./types";

interface ItemChildrenProps extends MediaServerContext {
  itemType: ItemMetadata["type"];
  childItems: EnrichedChildMetadata[];
  playableChildren: PlayableChildMetadata[];
  onPlay: (episode: PlayableChildMetadata) => void;
}

export function ItemChildren({
  itemType,
  childItems,
  playableChildren,
  onPlay,
  serverId,
  serverUrl,
  authToken,
}: ItemChildrenProps) {
  if (childItems.length === 0) {
    return null;
  }

  if (itemType === "show") {
    return (
      <SeasonGrid
        seasons={childItems}
        serverId={serverId}
        serverUrl={serverUrl}
        authToken={authToken}
      />
    );
  }

  if (itemType === "season") {
    const playableByRatingKey = new Map(
      playableChildren.map((episode) => [episode.ratingKey, episode]),
    );

    return (
      <EpisodeGrid
        episodes={childItems}
        playableByRatingKey={playableByRatingKey}
        serverId={serverId}
        serverUrl={serverUrl}
        authToken={authToken}
        onPlay={onPlay}
      />
    );
  }

  return null;
}
