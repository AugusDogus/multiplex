/**
 * Stable collection row keys for the TanStack DB sync spike.
 * Keep these pure so unit tests can cover them without browser APIs.
 */

export function serverRowKey(clientIdentifier: string): string {
  return clientIdentifier;
}

export function continueWatchingRowKey(
  serverId: string,
  ratingKey: string,
): string {
  return `${serverId}:${ratingKey}`;
}

export function homeHubRowKey(serverId: string, hubKey: string): string {
  return `${serverId}:${hubKey}`;
}

export function serverLibraryRowKey(serverId: string): string {
  return serverId;
}

export function mediaItemRowKey(serverId: string, ratingKey: string): string {
  return `${serverId}:${ratingKey}`;
}

export function parseCompositeKey(
  key: string,
): { serverId: string; localKey: string } | null {
  const separator = key.indexOf(":");
  if (separator <= 0 || separator === key.length - 1) {
    return null;
  }
  return {
    serverId: key.slice(0, separator),
    localKey: key.slice(separator + 1),
  };
}
