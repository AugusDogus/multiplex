import { getServerUrl, type PlexDevice } from "@multiplex/plex-query";

import {
  getItemConnection,
  getServerConnection,
  type PlexConnectionCredentials,
} from "./connection-overlay";
import { getActiveSyncEngineCollections } from "./registry";
import type { SanitizedServerRow } from "./sanitize";

function credentialsFromServerRow(
  row: SanitizedServerRow,
): PlexConnectionCredentials | undefined {
  if (!row.accessToken) return undefined;

  // getServerUrl only reads `connections`; sanitize rows omit unused PlexDevice fields.
  const device = {
    connections: row.connections.map((connection) => ({
      protocol: connection.protocol ?? undefined,
      address: connection.address ?? undefined,
      port: connection.port ?? undefined,
      uri: connection.uri ?? undefined,
      local: connection.local ?? false,
      relay: connection.relay ?? false,
    })),
  } as unknown as PlexDevice;

  return {
    serverUrl: getServerUrl(device),
    authToken: row.accessToken,
  };
}

/**
 * Resolve PMS credentials for a server: session overlay first, then the
 * persisted servers collection (accessToken + connections).
 */
export function resolveServerCredentials(
  serverId: string,
): PlexConnectionCredentials | undefined {
  const overlay = getServerConnection(serverId);
  if (overlay?.serverUrl && overlay.authToken) {
    return overlay;
  }

  const row = getActiveSyncEngineCollections()?.servers.get(serverId);
  const fromRow = row ? credentialsFromServerRow(row) : undefined;
  if (!fromRow) {
    return overlay;
  }

  return {
    serverUrl: overlay?.serverUrl ?? fromRow.serverUrl,
    authToken: overlay?.authToken ?? fromRow.authToken,
  };
}

/**
 * Prefer durable row credentials, then item overlay, then server-level lookup.
 */
export function resolveItemCredentials(
  itemId: string,
  row?: {
    serverId?: string | null;
    serverUrl?: string | null;
    authToken?: string | null;
  },
): PlexConnectionCredentials {
  const itemOverlay = getItemConnection(itemId);
  const serverId = row?.serverId ?? itemId.split(":")[0];
  const serverCredentials = serverId
    ? resolveServerCredentials(serverId)
    : undefined;

  return {
    serverUrl:
      row?.serverUrl ??
      itemOverlay?.serverUrl ??
      serverCredentials?.serverUrl ??
      undefined,
    authToken:
      row?.authToken ??
      itemOverlay?.authToken ??
      serverCredentials?.authToken ??
      undefined,
  };
}
