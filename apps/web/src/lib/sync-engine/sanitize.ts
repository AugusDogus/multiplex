/**
 * Normalize Plex payloads for the durable local replica (OPFS).
 * PMS credentials are persisted so the client can talk to servers directly
 * (same model as official Plex); the replica is wiped on logout.
 */

import type {
  ContinueWatchingItemWithServer,
  HubItemWithServer,
  HubWithServer,
  PlexDevice,
  PlexUserInfo,
  WatchTogetherRoom,
} from "@multiplex/plex-query";

import type { RouterOutputs } from "~/trpc/api";
import {
  libraryHubsSnapshotKey,
  mediaItemRowKey,
  USER_INFO_ROW_ID,
} from "./keys";

type PlexOutputs = RouterOutputs["plex"];
type ServerLibrary = PlexOutputs["getAllServerLibraries"][number];
type ItemDetails = NonNullable<PlexOutputs["getItemDetails"]>;
type ItemMetadata = NonNullable<PlexOutputs["getItemMetadata"]>;
type WatchTogetherInvitee = PlexOutputs["getWatchTogetherInvitees"][number];

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
  connections: PlexDevice["connections"];
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
  /**
   * Position in the `getAllContinueWatching` response. Restores carousel order
   * after TanStack DB yields rows by lexicographic `id`.
   */
  listIndex: number | null;
  hubTitle: string | null;
  hubType: string | null;
  librarySectionTitle: string | null;
  librarySectionID: number | null;
  librarySectionKey: string | null;
  /** Stream metadata for toPlayableMetadata. */
  Media: ContinueWatchingItemWithServer["Media"] | null;
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
  mediaProviders: ServerLibrary["mediaProviders"];
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
  item: ItemMetadata;
  children: ItemDetails["children"];
  playableChildren: ItemDetails["playableChildren"];
  playTarget: ItemDetails["playTarget"];
  /** Non-null once full details were fetched, with the successful fetch time. */
  fullDetailsUpdatedAt: number | null;
};

export const MEDIA_ITEM_DETAILS_STALE_TIME_MS = 5 * 60_000;

export function hasFreshMediaItemDetails(
  row: SanitizedMediaItemRow | undefined,
  now = Date.now(),
): boolean {
  const updatedAt = row?.fullDetailsUpdatedAt;
  if (updatedAt === undefined || updatedAt === null) {
    return false;
  }

  const age = now - updatedAt;
  return age >= 0 && age < MEDIA_ITEM_DETAILS_STALE_TIME_MS;
}

export type SanitizedWatchTogetherRoomRow = {
  id: string;
  sourceUri: string;
  source: WatchTogetherRoom["source"] | null;
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
  payload: Omit<PlexUserInfo, "authToken">;
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
  payload: PlexOutputs["search"];
};

export type SanitizedPlaylistRow = {
  id: string;
  serverId: string;
  playlistRatingKey: string;
  payload: PlexOutputs["getPlaylist"];
};

export type SanitizedPlaylistContentsRow = {
  id: string;
  serverId: string;
  playlistRatingKey: string;
  start: number;
  size: number;
  payload: PlexOutputs["getPlaylistContents"];
};

export type SanitizedItemPlaylistsRow = {
  id: string;
  serverId: string;
  playlistType: string;
  payload: PlexOutputs["getItemPlaylists"];
};

export type SanitizedLibraryFilterValuesRow = {
  id: string;
  machineIdentifier: string;
  filterPath: string;
  values: PlexOutputs["getLibraryFilterValues"];
};

export type SanitizedPlayQueueRow = {
  id: string;
  serverId: string;
  playQueueId: string;
  payload: PlexOutputs["getPlayQueue"];
};

/** Clone typed query output before handing it to the durable OPFS replica. */
export function cloneForPersistence<T>(value: T): T {
  return structuredClone(value);
}

type HubItemInput = Partial<HubItemWithServer>;
type HubInput = Omit<HubWithServer, "items"> & { items: HubItemInput[] };
type ContinueWatchingInput = Partial<ContinueWatchingItemWithServer> &
  Pick<ContinueWatchingItemWithServer, "serverId" | "ratingKey" | "title">;

function sanitizeHubItem(item: HubItemInput): SanitizedHomeHubItem | null {
  if (!item.ratingKey) return null;
  return {
    ratingKey: item.ratingKey,
    key: item.key ?? null,
    type: item.type ?? "movie",
    title: item.title ?? item.ratingKey,
    thumb: item.thumb ?? null,
    parentThumb: item.parentThumb ?? null,
    grandparentThumb: item.grandparentThumb ?? null,
    year: item.year ?? null,
    parentTitle: item.parentTitle ?? null,
    grandparentTitle: item.grandparentTitle ?? null,
    parentIndex: item.parentIndex ?? null,
    index: item.index ?? null,
    childCount: item.childCount ?? null,
    leafCount: item.leafCount ?? null,
    subtype: item.subtype ?? null,
    playlistType: item.playlistType ?? null,
    composite: item.composite ?? null,
    serverUrl: item.serverUrl ?? null,
    authToken: item.authToken ?? null,
  };
}

export function sanitizeServer(device: PlexDevice): SanitizedServerRow {
  return {
    id: device.clientIdentifier,
    name: device.name,
    product: device.product,
    productVersion: device.productVersion,
    platform: device.platform,
    platformVersion: device.platformVersion,
    device: device.device,
    clientIdentifier: device.clientIdentifier,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    provides: device.provides,
    owned: device.owned,
    home: device.home,
    presence: device.presence,
    publicAddress: device.publicAddress,
    httpsRequired: device.httpsRequired,
    synced: device.synced,
    relay: device.relay,
    accessToken: device.accessToken,
    connections: cloneForPersistence(device.connections),
  };
}

export function sanitizeContinueWatchingItem(
  item: ContinueWatchingInput,
  options?: { listIndex?: number | null },
): SanitizedContinueWatchingRow {
  return {
    id: `${item.serverId}:${item.ratingKey}`,
    serverId: item.serverId,
    serverName: item.serverName ?? null,
    serverUrl: item.serverUrl ?? null,
    authToken: item.authToken ?? null,
    ratingKey: item.ratingKey,
    key: item.key ?? null,
    type: item.type ?? "movie",
    title: item.title,
    grandparentTitle: item.grandparentTitle ?? null,
    parentTitle: item.parentTitle ?? null,
    parentRatingKey: item.parentRatingKey ?? null,
    grandparentRatingKey: item.grandparentRatingKey ?? null,
    parentIndex: item.parentIndex ?? null,
    index: item.index ?? null,
    thumb: item.thumb ?? null,
    art: item.art ?? null,
    parentThumb: item.parentThumb ?? null,
    grandparentThumb: item.grandparentThumb ?? null,
    year: item.year ?? null,
    contentRating: item.contentRating ?? null,
    viewOffset: item.viewOffset ?? null,
    duration: item.duration ?? null,
    progressPercent: item.progressPercent ?? null,
    isCompleted: item.isCompleted ?? null,
    timeRemaining: item.timeRemaining ?? null,
    lastViewedAt: item.lastViewedAt
      ? Math.floor(item.lastViewedAt.getTime() / 1000)
      : null,
    listIndex: options?.listIndex ?? null,
    hubTitle: item.hubTitle ?? null,
    hubType: item.hubType ?? null,
    librarySectionTitle: item.librarySectionTitle ?? null,
    librarySectionID: item.librarySectionID ?? null,
    librarySectionKey: item.librarySectionKey ?? null,
    Media: item.Media ?? null,
  };
}

export function sanitizeHomeHub(hub: HubInput): SanitizedHomeHubRow {
  const hubKey = hub.key ?? hub.hubKey ?? hub.hubIdentifier;
  return {
    id: `${hub.serverId}:${hubKey}`,
    serverId: hub.serverId,
    hubKey,
    title: hub.title,
    type: hub.type,
    hubIdentifier: hub.hubIdentifier,
    size: hub.size,
    more: hub.more ?? null,
    items: hub.items.flatMap((entry) => {
      const item = sanitizeHubItem(entry);
      return item ? [item] : [];
    }),
  };
}

export function sanitizeLibraryHubsSnapshot(
  machineIdentifier: string,
  sectionId: string,
  hubs: HubWithServer[],
): SanitizedLibraryHubsSnapshotRow {
  return {
    id: libraryHubsSnapshotKey(machineIdentifier, sectionId),
    machineIdentifier,
    sectionId,
    hubs: hubs.map((hub) => sanitizeHomeHub(hub)),
  };
}

function extractLibrariesFromMediaProviders(
  mediaProviders: ServerLibrary["mediaProviders"],
): SanitizedServerLibraryRow["libraries"] {
  const libraries: SanitizedServerLibraryRow["libraries"] = [];
  for (const provider of mediaProviders?.MediaContainer.MediaProvider ?? []) {
    for (const feature of provider.Feature) {
      for (const directory of feature.Directory ?? []) {
        if (!("id" in directory)) continue;
        const id = directory.id;
        if (!id || Number.isNaN(Number(id))) continue;
        libraries.push({
          id: String(id),
          key: "key" in directory ? (directory.key ?? null) : null,
          title: directory.title ?? null,
          type: "type" in directory ? (directory.type ?? null) : null,
        });
      }
    }
  }

  return libraries;
}

export function sanitizeServerLibrary(
  entry: ServerLibrary,
): SanitizedServerLibraryRow {
  return {
    id: entry.serverId,
    serverId: entry.serverId,
    serverName: entry.serverName,
    serverOwned: entry.serverOwned,
    error: entry.error ?? null,
    mediaProviders: cloneForPersistence(entry.mediaProviders),
    libraries: extractLibrariesFromMediaProviders(entry.mediaProviders),
  };
}

type MediaItemDetailsInput = Pick<
  ItemDetails,
  | "item"
  | "children"
  | "playableChildren"
  | "playTarget"
  | "serverName"
  | "serverUrl"
  | "authToken"
>;

export function sanitizeMediaItemDetails(
  details: MediaItemDetailsInput,
  serverId: string,
  options?: { fullDetailsUpdatedAt: number },
): SanitizedMediaItemRow {
  const metadata = details.item;
  return {
    id: mediaItemRowKey(serverId, metadata.ratingKey),
    serverId,
    serverName: details.serverName ?? null,
    serverUrl: details.serverUrl ?? null,
    authToken: details.authToken ?? null,
    ratingKey: metadata.ratingKey,
    type: metadata.type,
    title: metadata.title,
    summary: metadata.summary ?? null,
    thumb: metadata.thumb ?? null,
    art: metadata.art ?? null,
    year: metadata.year ?? null,
    duration: metadata.duration ?? null,
    viewOffset: metadata.viewOffset ?? null,
    viewCount: metadata.viewCount ?? null,
    leafCount: metadata.leafCount ?? null,
    childCount: metadata.childCount ?? null,
    item: cloneForPersistence(metadata),
    children: cloneForPersistence(details.children),
    playableChildren: cloneForPersistence(details.playableChildren),
    playTarget: cloneForPersistence(details.playTarget),
    // Fail closed: metadata-only writes must not look fully warmed.
    fullDetailsUpdatedAt: options?.fullDetailsUpdatedAt ?? null,
  };
}

export function sanitizeWatchTogetherRoom(
  room: WatchTogetherRoom,
): SanitizedWatchTogetherRoomRow {
  return {
    id: room.id,
    sourceUri: room.sourceUri,
    source: room.source ?? null,
    title: room.title,
    type: room.type,
    startsAt: room.startsAt ?? null,
    endsAt: room.endsAt ?? null,
    updatedAt: room.updatedAt ?? null,
    syncplayHost: room.syncplayHost,
    syncplayPort: room.syncplayPort,
    users: room.users.map((user) => ({
      id: user.id,
      title: user.title ?? null,
      username: user.username ?? null,
      thumb: user.thumb ?? null,
    })),
  };
}

export function sanitizeUserInfo(user: PlexUserInfo): SanitizedUserInfoRow {
  const { authToken, ...payload } = user;
  void authToken;
  return {
    id: USER_INFO_ROW_ID,
    plexUserId: user.id,
    uuid: user.uuid,
    username: user.username,
    title: user.title,
    email: user.email,
    thumb: user.thumb,
    payload: cloneForPersistence(payload),
  };
}

export function sanitizeWatchTogetherInvitee(
  invitee: WatchTogetherInvitee,
): SanitizedWatchTogetherInviteeRow {
  return {
    id: String(invitee.id),
    plexUserId: invitee.id,
    uuid: invitee.uuid,
    title: invitee.title,
    username: invitee.username,
    thumb: invitee.thumb ?? null,
    restricted: invitee.restricted,
  };
}

export function sanitizeBrowsePageItems(
  items: HubItemWithServer[],
): Array<SanitizedHomeHubItem & { serverId: string }> {
  return items.flatMap((entry) => {
    const item = sanitizeHubItem(entry);
    return item ? [{ ...item, serverId: entry.serverId }] : [];
  });
}
