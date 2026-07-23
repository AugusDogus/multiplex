/**
 * Session-warm Plex connection credentials.
 * Durable copies also live on sync-engine rows (wiped on logout). This map
 * avoids a servers-collection lookup on hot paths during the current session.
 */

export type PlexConnectionCredentials = {
  serverUrl: string | undefined;
  authToken: string | undefined;
};

const byServerId = new Map<string, PlexConnectionCredentials>();
const byItemId = new Map<string, PlexConnectionCredentials>();

export function rememberServerConnection(
  serverId: string,
  credentials: PlexConnectionCredentials,
): void {
  if (!credentials.serverUrl && !credentials.authToken) return;
  byServerId.set(serverId, credentials);
}

export function rememberItemConnection(
  itemId: string,
  credentials: PlexConnectionCredentials,
): void {
  if (!credentials.serverUrl && !credentials.authToken) return;
  byItemId.set(itemId, credentials);
  const serverId = itemId.split(":")[0];
  if (serverId) {
    rememberServerConnection(serverId, credentials);
  }
}

export function getItemConnection(
  itemId: string,
): PlexConnectionCredentials | undefined {
  return byItemId.get(itemId) ?? undefined;
}

export function getServerConnection(
  serverId: string,
): PlexConnectionCredentials | undefined {
  return byServerId.get(serverId);
}

/** Clear session credentials (logout / account switch). */
export function clearConnectionOverlay(): void {
  byServerId.clear();
  byItemId.clear();
}
