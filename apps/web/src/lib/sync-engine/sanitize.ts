/**
 * Strip Plex credentials from rows before they enter the durable local replica.
 * OPFS/SQLite persistence must never store access tokens.
 */

export type SanitizedServerRow = {
  id: string;
  name: string;
  product: string | null;
  productVersion: string | null;
  platform: string | null;
  platformVersion: string | null;
  device: string | null;
  clientIdentifier: string;
  createdAt: string | null;
  lastSeenAt: string | null;
  provides: string | null;
  owned: boolean;
  home: boolean;
  presence: boolean;
  publicAddress: string | null;
  httpsRequired: boolean | null;
  synced: boolean | null;
  relay: boolean | null;
  /** Connection hosts only — never tokens. */
  connections: Array<{
    protocol: string | null;
    address: string | null;
    port: number | null;
    uri: string | null;
    local: boolean | null;
    relay: boolean | null;
  }>;
};

/**
 * Continue Watching row rich enough for home UI + playback metadata.
 * Credentials live only in the session connection overlay.
 */
export type SanitizedContinueWatchingRow = {
  id: string;
  serverId: string;
  serverName: string | null;
  ratingKey: string;
  key: string | null;
  type: string;
  title: string;
  grandparentTitle: string | null;
  parentTitle: string | null;
  parentRatingKey: string | null;
  grandparentRatingKey: string | null;
  parentIndex: number | null;
  index: number | null;
  thumb: string | null;
  art: string | null;
  parentThumb: string | null;
  grandparentThumb: string | null;
  year: number | null;
  contentRating: string | null;
  viewOffset: number | null;
  duration: number | null;
  progressPercent: number | null;
  isCompleted: boolean | null;
  timeRemaining: number | null;
  /** Unix seconds (Plex) or null. */
  lastViewedAt: number | null;
  hubTitle: string | null;
  hubType: string | null;
  librarySectionTitle: string | null;
  librarySectionID: number | null;
  librarySectionKey: string | null;
  /** Stream metadata for toPlayableMetadata — no tokens. */
  Media: unknown;
};

export type SanitizedHomeHubRow = {
  id: string;
  serverId: string;
  hubKey: string;
  title: string | null;
  type: string | null;
  hubIdentifier: string | null;
  size: number | null;
  items: Array<{
    ratingKey: string;
    type: string | null;
    title: string | null;
    thumb: string | null;
    year: number | null;
  }>;
};

export type SanitizedServerLibraryRow = {
  id: string;
  serverId: string;
  serverName: string;
  serverOwned: boolean;
  error: string | null;
  /**
   * Full media-providers payload for sidebar source extraction.
   * Contains no Plex auth tokens (those live on the device/session).
   */
  mediaProviders: unknown;
  libraries: Array<{
    id: string | null;
    key: string | null;
    title: string | null;
    type: string | null;
  }>;
};

export type SanitizedMediaItemRow = {
  id: string;
  serverId: string;
  serverName: string | null;
  ratingKey: string;
  type: string | null;
  title: string | null;
  summary: string | null;
  thumb: string | null;
  art: string | null;
  year: number | null;
  duration: number | null;
  viewOffset: number | null;
  viewCount: number | null;
  leafCount: number | null;
  childCount: number | null;
};

type LooseRecord = Record<string, unknown>;

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asUnixSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  return null;
}

export function sanitizeServer(device: LooseRecord): SanitizedServerRow {
  const clientIdentifier = asString(device.clientIdentifier) ?? "unknown";
  const connectionsRaw = Array.isArray(device.connections)
    ? device.connections
    : [];

  return {
    id: clientIdentifier,
    name: asString(device.name) ?? clientIdentifier,
    product: asString(device.product),
    productVersion: asString(device.productVersion),
    platform: asString(device.platform),
    platformVersion: asString(device.platformVersion),
    device: asString(device.device),
    clientIdentifier,
    createdAt: asString(device.createdAt),
    lastSeenAt: asString(device.lastSeenAt),
    provides: asString(device.provides),
    owned: asBoolean(device.owned) ?? false,
    home: asBoolean(device.home) ?? false,
    presence: asBoolean(device.presence) ?? false,
    publicAddress: asString(device.publicAddress),
    httpsRequired: asBoolean(device.httpsRequired),
    synced: asBoolean(device.synced),
    relay: asBoolean(device.relay),
    connections: connectionsRaw.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const connection = entry as LooseRecord;
      return [
        {
          protocol: asString(connection.protocol),
          address: asString(connection.address),
          port: asNumber(connection.port),
          uri: asString(connection.uri),
          local: asBoolean(connection.local),
          relay: asBoolean(connection.relay),
        },
      ];
    }),
  };
}

export function sanitizeContinueWatchingItem(
  item: LooseRecord,
): SanitizedContinueWatchingRow {
  const serverId = asString(item.serverId) ?? "unknown";
  const ratingKey = asString(item.ratingKey) ?? "unknown";
  return {
    id: `${serverId}:${ratingKey}`,
    serverId,
    serverName: asString(item.serverName),
    ratingKey,
    key: asString(item.key),
    type: asString(item.type) ?? "movie",
    title: asString(item.title) ?? ratingKey,
    grandparentTitle: asString(item.grandparentTitle),
    parentTitle: asString(item.parentTitle),
    parentRatingKey: asString(item.parentRatingKey),
    grandparentRatingKey: asString(item.grandparentRatingKey),
    parentIndex: asNumber(item.parentIndex),
    index: asNumber(item.index),
    thumb: asString(item.thumb),
    art: asString(item.art),
    parentThumb: asString(item.parentThumb),
    grandparentThumb: asString(item.grandparentThumb),
    year: asNumber(item.year),
    contentRating: asString(item.contentRating),
    viewOffset: asNumber(item.viewOffset),
    duration: asNumber(item.duration),
    progressPercent: asNumber(item.progressPercent),
    isCompleted: asBoolean(item.isCompleted),
    timeRemaining: asNumber(item.timeRemaining),
    lastViewedAt: asUnixSeconds(item.lastViewedAt),
    hubTitle: asString(item.hubTitle),
    hubType: asString(item.hubType),
    librarySectionTitle: asString(item.librarySectionTitle),
    librarySectionID: asNumber(item.librarySectionID),
    librarySectionKey: asString(item.librarySectionKey),
    Media: Array.isArray(item.Media) ? item.Media : null,
  };
}

export function sanitizeHomeHub(hub: LooseRecord): SanitizedHomeHubRow {
  const serverId = asString(hub.serverId) ?? "unknown";
  const hubKey =
    asString(hub.key) ??
    asString(hub.hubKey) ??
    asString(hub.hubIdentifier) ??
    "hub";
  const itemsRaw = Array.isArray(hub.items) ? hub.items : [];

  return {
    id: `${serverId}:${hubKey}`,
    serverId,
    hubKey,
    title: asString(hub.title),
    type: asString(hub.type),
    hubIdentifier: asString(hub.hubIdentifier),
    size: asNumber(hub.size),
    items: itemsRaw.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as LooseRecord;
      const ratingKey = asString(item.ratingKey);
      if (!ratingKey) return [];
      return [
        {
          ratingKey,
          type: asString(item.type),
          title: asString(item.title),
          thumb: asString(item.thumb),
          year: asNumber(item.year),
        },
      ];
    }),
  };
}

function extractLibrariesFromMediaProviders(
  mediaProviders: unknown,
): SanitizedServerLibraryRow["libraries"] {
  if (!mediaProviders || typeof mediaProviders !== "object") {
    return [];
  }

  const root = mediaProviders as LooseRecord;
  const container =
    root.MediaContainer && typeof root.MediaContainer === "object"
      ? (root.MediaContainer as LooseRecord)
      : root;
  const providers = Array.isArray(container.MediaProvider)
    ? container.MediaProvider
    : [];

  const libraries: SanitizedServerLibraryRow["libraries"] = [];

  for (const provider of providers) {
    if (!provider || typeof provider !== "object") continue;
    const features = Array.isArray((provider as LooseRecord).Feature)
      ? ((provider as LooseRecord).Feature as unknown[])
      : [];
    for (const feature of features) {
      if (!feature || typeof feature !== "object") continue;
      const directories = Array.isArray((feature as LooseRecord).Directory)
        ? ((feature as LooseRecord).Directory as unknown[])
        : [];
      for (const directory of directories) {
        if (!directory || typeof directory !== "object") continue;
        const library = directory as LooseRecord;
        const id = asString(library.id);
        if (!id || Number.isNaN(Number(id))) continue;
        libraries.push({
          id,
          key: asString(library.key),
          title: asString(library.title),
          type: asString(library.type),
        });
      }
    }
  }

  return libraries;
}

export function sanitizeServerLibrary(
  entry: LooseRecord,
): SanitizedServerLibraryRow {
  const serverId = asString(entry.serverId) ?? "unknown";
  const mediaProviders = entry.mediaProviders ?? null;

  return {
    id: serverId,
    serverId,
    serverName: asString(entry.serverName) ?? serverId,
    serverOwned: asBoolean(entry.serverOwned) ?? false,
    error: asString(entry.error),
    mediaProviders,
    libraries: extractLibrariesFromMediaProviders(mediaProviders),
  };
}

export function sanitizeMediaItemDetails(
  details: LooseRecord,
  serverId: string,
): SanitizedMediaItemRow | null {
  const item = details.item;
  if (!item || typeof item !== "object") return null;
  const metadata = item as LooseRecord;
  const ratingKey = asString(metadata.ratingKey);
  if (!ratingKey) return null;

  return {
    id: `${serverId}:${ratingKey}`,
    serverId,
    serverName: asString(details.serverName),
    ratingKey,
    type: asString(metadata.type),
    title: asString(metadata.title),
    summary: asString(metadata.summary),
    thumb: asString(metadata.thumb),
    art: asString(metadata.art),
    year: asNumber(metadata.year),
    duration: asNumber(metadata.duration),
    viewOffset: asNumber(metadata.viewOffset),
    viewCount: asNumber(metadata.viewCount),
    leafCount: asNumber(metadata.leafCount),
    childCount: asNumber(metadata.childCount),
  };
}

/** Defensive check used by tests and boot assertions. */
export function rowContainsCredentialFields(row: LooseRecord): string[] {
  const forbidden = [
    "accessToken",
    "authToken",
    "plexAuthToken",
    "token",
    "X-Plex-Token",
  ];
  return forbidden.filter((key) => key in row && row[key] != null);
}
