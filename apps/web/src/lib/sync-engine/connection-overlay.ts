/**
 * Session-only Plex connection credentials.
 * Populated when sync queryFns fetch from the network; never written to OPFS.
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

/** Test helper. */
export function clearConnectionOverlayForTests(): void {
  byServerId.clear();
  byItemId.clear();
}
