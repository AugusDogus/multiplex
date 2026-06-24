const WATCH_TOGETHER_SOURCE_PATTERN =
  /^server:\/\/(?<serverId>[^/]+)\/com\.plexapp\.plugins\.library\/library\/metadata\/(?<ratingKey>[^/?#]+)/;

export interface WatchTogetherSource {
  serverId: string;
  ratingKey: string;
}

export function parseWatchTogetherSourceUri(
  sourceUri: string,
): WatchTogetherSource | null {
  const match = WATCH_TOGETHER_SOURCE_PATTERN.exec(sourceUri);
  if (!match?.groups?.serverId || !match.groups.ratingKey) {
    return null;
  }

  return {
    serverId: match.groups.serverId,
    ratingKey: match.groups.ratingKey,
  };
}

export function getWatchTogetherRoomHref(roomId: string): string {
  return `/watch-together/${roomId}`;
}
