/**
 * Normalize Plex payloads for the durable local replica (OPFS).
 * PMS credentials are persisted so the client can talk to servers directly
 * (same model as official Plex); the replica is wiped on logout.
 */

import {
  libraryHubsSnapshotKey,
  mediaItemRowKey,
  USER_INFO_ROW_ID,
} from "./keys";

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
  /** PMS access token — persisted for direct client access; wiped on logout. */
  accessToken: string | null;
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
 * Continue Watching row rich enough for home UI + playback + direct PMS artwork.
 * Cleared from OPFS on logout with the rest of the sync engine.
 */
export type SanitizedContinueWatchingRow = {
  id: string;
  serverId: string;
  serverName: string | null;
  serverUrl: string | null;
  authToken: string | null;
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
  /** Stream metadata for toPlayableMetadata. */
  Media: unknown;
};

export type SanitizedHomeHubItem = {
  ratingKey: string;
  key: string | null;
  type: string;
  title: string;
  thumb: string | null;
  parentThumb: string | null;
  grandparentThumb: string | null;
  year: number | null;
  parentTitle: string | null;
  grandparentTitle: string | null;
  parentIndex: number | null;
  index: number | null;
  childCount: number | null;
  leafCount: number | null;
  subtype: string | null;
  playlistType: string | null;
  composite: string | null;
  serverUrl: string | null;
  authToken: string | null;
};

export type SanitizedHomeHubRow = {
  id: string;
  serverId: string;
  hubKey: string;
  title: string;
  type: string | null;
  hubIdentifier: string | null;
  size: number;
  more: boolean | null;
  items: SanitizedHomeHubItem[];
};

/** One durable snapshot per library Recommended tab. */
export type SanitizedLibraryHubsSnapshotRow = {
  id: string;
  machineIdentifier: string;
  sectionId: string;
  hubs: SanitizedHomeHubRow[];
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

/**
 * Full item-details payload for details pages + WT media.
 * Includes PMS connection credentials for direct artwork/playback (cleared on logout).
 */
export type SanitizedMediaItemRow = {
  id: string;
  serverId: string;
  serverName: string | null;
  serverUrl: string | null;
  authToken: string | null;
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
  /** Full PMS metadata object (no tokens). */
  item: unknown;
  children: unknown[];
  playableChildren: unknown[];
  playTarget: unknown;
  /** True once `getItemDetails` (not just metadata) has been warmed. */
  hasFullDetails: boolean;
};

export type SanitizedWatchTogetherRoomRow = {
  id: string;
  sourceUri: string;
  source: unknown;
  title: string;
  type: string | null;
  startsAt: number | null;
  endsAt: number | null;
  updatedAt: number | null;
  syncplayHost: string | null;
  syncplayPort: number | null;
  users: Array<{
    id: number;
    title: string | null;
    username: string | null;
    thumb: string | null;
  }>;
};

export type SanitizedUserInfoRow = {
  id: typeof USER_INFO_ROW_ID;
  plexUserId: number;
  uuid: string | null;
  username: string | null;
  title: string | null;
  email: string | null;
  thumb: string | null;
  /** Full plex.tv user payload without authToken. */
  payload: unknown;
};

export type SanitizedWatchTogetherInviteeRow = {
  id: string;
  plexUserId: number;
  uuid: string | null;
  title: string;
  username: string;
  thumb: string | null;
  restricted: boolean;
};

export type SanitizedBrowsePageRow = {
  id: string;
  contentKey: string;
  pageSize: number;
  pageIndex: number;
  totalSize: number;
  items: Array<SanitizedHomeHubItem & { serverId: string }>;
};

export type SanitizedSearchResultsRow = {
  id: string;
  query: string;
  payload: unknown;
};

export type SanitizedPlaylistRow = {
  id: string;
  serverId: string;
  playlistRatingKey: string;
  payload: unknown;
};

export type SanitizedPlaylistContentsRow = {
  id: string;
  serverId: string;
  playlistRatingKey: string;
  start: number;
  size: number;
  payload: unknown;
};

export type SanitizedItemPlaylistsRow = {
  id: string;
  serverId: string;
  playlistType: string;
  payload: unknown;
};

export type SanitizedLibraryFilterValuesRow = {
  id: string;
  machineIdentifier: string;
  filterPath: string;
  values: unknown[];
};

export type SanitizedPlayQueueRow = {
  id: string;
  serverId: string;
  playQueueId: string;
  payload: unknown;
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

/**
 * Deep-clone JSON-like payloads for OPFS.
 * Credentials are intentionally persisted (cleared on logout) so the client can
 * talk to PMS directly like the official Plex app.
 *
 * Optionally remembers session connection overlay entries when
 * `serverId`+`ratingKey` are present alongside tokens.
 */
export function stripCredentialsDeep(
  value: unknown,
  rememberConnection?: (
    itemId: string,
    credentials: {
      serverUrl: string | undefined;
      authToken: string | undefined;
    },
  ) => void,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      stripCredentialsDeep(entry, rememberConnection),
    );
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as LooseRecord;
  const serverId = asString(record.serverId);
  const ratingKey = asString(record.ratingKey);
  if (rememberConnection && serverId && ratingKey) {
    rememberConnection(`${serverId}:${ratingKey}`, {
      serverUrl: asString(record.serverUrl) ?? undefined,
      authToken: asString(record.authToken) ?? undefined,
    });
  }
  const next: LooseRecord = {};
  for (const [key, entry] of Object.entries(record)) {
    next[key] = stripCredentialsDeep(entry, rememberConnection);
  }
  return next;
}

/** @deprecated Credentials are persisted; kept as a deep clone helper. */
export const stripCredentialFields = stripCredentialsDeep;

function sanitizeHubItem(item: LooseRecord): SanitizedHomeHubItem | null {
  const ratingKey = asString(item.ratingKey);
  if (!ratingKey) return null;
  return {
    ratingKey,
    key: asString(item.key),
    type: asString(item.type) ?? "movie",
    title: asString(item.title) ?? ratingKey,
    thumb: asString(item.thumb),
    parentThumb: asString(item.parentThumb),
    grandparentThumb: asString(item.grandparentThumb),
    year: asNumber(item.year),
    parentTitle: asString(item.parentTitle),
    grandparentTitle: asString(item.grandparentTitle),
    parentIndex: asNumber(item.parentIndex),
    index: asNumber(item.index),
    childCount: asNumber(item.childCount),
    leafCount: asNumber(item.leafCount),
    subtype: asString(item.subtype),
    playlistType: asString(item.playlistType),
    composite: asString(item.composite),
    serverUrl: asString(item.serverUrl),
    authToken: asString(item.authToken),
  };
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
    accessToken: asString(device.accessToken),
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
    serverUrl: asString(item.serverUrl),
    authToken: asString(item.authToken),
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
    title: asString(hub.title) ?? hubKey,
    type: asString(hub.type),
    hubIdentifier: asString(hub.hubIdentifier),
    size: asNumber(hub.size) ?? 0,
    more: asBoolean(hub.more),
    items: itemsRaw.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = sanitizeHubItem(entry as LooseRecord);
      return item ? [item] : [];
    }),
  };
}

export function sanitizeLibraryHubsSnapshot(
  machineIdentifier: string,
  sectionId: string,
  hubs: LooseRecord[],
): SanitizedLibraryHubsSnapshotRow {
  return {
    id: libraryHubsSnapshotKey(machineIdentifier, sectionId),
    machineIdentifier,
    sectionId,
    hubs: hubs.map((hub) => sanitizeHomeHub(hub)),
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
    mediaProviders: stripCredentialsDeep(mediaProviders),
    libraries: extractLibrariesFromMediaProviders(mediaProviders),
  };
}

export function sanitizeMediaItemDetails(
  details: LooseRecord,
  serverId: string,
  options?: { hasFullDetails?: boolean },
): SanitizedMediaItemRow | null {
  const item = details.item;
  if (!item || typeof item !== "object") return null;
  const metadata = item as LooseRecord;
  const ratingKey = asString(metadata.ratingKey);
  if (!ratingKey) return null;

  const children = Array.isArray(details.children) ? details.children : [];
  const playableChildren = Array.isArray(details.playableChildren)
    ? details.playableChildren
    : [];

  return {
    id: mediaItemRowKey(serverId, ratingKey),
    serverId,
    serverName: asString(details.serverName),
    serverUrl: asString(details.serverUrl),
    authToken: asString(details.authToken),
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
    item: stripCredentialsDeep(metadata),
    children: children.map((child) => stripCredentialsDeep(child)),
    playableChildren: playableChildren.map((child) =>
      stripCredentialsDeep(child),
    ),
    playTarget: stripCredentialsDeep(details.playTarget ?? null),
    // Fail closed: metadata-only writes must not look fully warmed.
    hasFullDetails: options?.hasFullDetails ?? false,
  };
}

export function sanitizeWatchTogetherRoom(
  room: LooseRecord,
): SanitizedWatchTogetherRoomRow {
  const id = asString(room.id) ?? "unknown";
  const usersRaw = Array.isArray(room.users) ? room.users : [];

  return {
    id,
    sourceUri: asString(room.sourceUri) ?? "",
    source: stripCredentialsDeep(room.source ?? null),
    title: asString(room.title) ?? id,
    type: asString(room.type),
    startsAt: asNumber(room.startsAt),
    endsAt: asNumber(room.endsAt),
    updatedAt: asNumber(room.updatedAt),
    syncplayHost: asString(room.syncplayHost),
    syncplayPort: asNumber(room.syncplayPort),
    users: usersRaw.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const user = entry as LooseRecord;
      const userId = asNumber(user.id);
      if (userId === null) return [];
      return [
        {
          id: userId,
          title: asString(user.title),
          username: asString(user.username),
          thumb: asString(user.thumb),
        },
      ];
    }),
  };
}

export function sanitizeUserInfo(user: LooseRecord): SanitizedUserInfoRow {
  const plexUserId = asNumber(user.id) ?? 0;
  return {
    id: USER_INFO_ROW_ID,
    plexUserId,
    uuid: asString(user.uuid),
    username: asString(user.username),
    title: asString(user.title),
    email: asString(user.email),
    thumb: asString(user.thumb),
    payload: stripCredentialsDeep(user),
  };
}

export function sanitizeWatchTogetherInvitee(
  invitee: LooseRecord,
): SanitizedWatchTogetherInviteeRow {
  const plexUserId = asNumber(invitee.id) ?? 0;
  return {
    id: String(plexUserId),
    plexUserId,
    uuid: asString(invitee.uuid),
    title: asString(invitee.title) ?? "Plex user",
    username: asString(invitee.username) ?? "Plex user",
    thumb: asString(invitee.thumb),
    restricted: asBoolean(invitee.restricted) ?? false,
  };
}

export function sanitizeBrowsePageItems(
  items: LooseRecord[],
): Array<SanitizedHomeHubItem & { serverId: string }> {
  return items.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = sanitizeHubItem(entry);
    if (!item) return [];
    const serverId = asString(entry.serverId) ?? "unknown";
    return [{ ...item, serverId }];
  });
}

/** Defensive check used by tests and boot assertions (deep scan). */
export function rowContainsCredentialFields(row: LooseRecord): string[] {
  const forbidden = [
    "accessToken",
    "authToken",
    "plexAuthToken",
    "token",
    "X-Plex-Token",
  ];
  const found = new Set<string>();

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as LooseRecord;
    for (const key of forbidden) {
      if (key in record && record[key] != null) found.add(key);
    }
    for (const entry of Object.values(record)) walk(entry);
  };

  walk(row);
  return [...found];
}
