import {
  findNextEpisodeRoom,
  parseLibraryItemUri,
  PlexTvClient,
  WatchTogetherClient,
  type PlayQueueItem,
  type PlayableMetadata,
  type PlexServerClient,
  type PlexTvClient as PlexTvClientType,
  type WatchTogetherRoom,
} from "@multiplex/plex-query";
import { eq } from "drizzle-orm";

import { NEXTJS_PLEX_CONFIG } from "~/lib/plex-config";
import type { GuestNextEpisode } from "~/lib/guest-watch-together-bootstrap";
import {
  resolveGuestAccess,
  type ResolveGuestAccess,
  type ResolvedGuestAccess,
} from "~/server/watch-together/guest-access";
import {
  createGuestCapabilityCodec,
  type GuestCapabilityCodec,
} from "~/server/watch-together/guest-capability";

export type GuestBootstrapFailureReason =
  | "invalid-invite"
  | "expired-invite"
  | "room-unavailable"
  | "guest-unavailable";

export type GuestBootstrapResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly room: Pick<
          WatchTogetherRoom,
          | "id"
          | "sourceUri"
          | "title"
          | "type"
          | "syncplayHost"
          | "syncplayPort"
          | "users"
        >;
        readonly host: { readonly id: number; readonly title: string };
        readonly guest: { readonly id: number; readonly title: string };
        readonly serverId: string;
        readonly serverUrl: string;
        readonly authToken: string;
        readonly item: PlayableMetadata;
        readonly nextEpisode: GuestNextEpisode | null;
      };
    }
  | { readonly ok: false; readonly reason: GuestBootstrapFailureReason };

export type GuestBootstrapDependencies = {
  readonly capabilityCodec: GuestCapabilityCodec;
  readonly loadHostToken: (hostUserId: string) => Promise<string | null>;
  readonly createPlexClient: (token: string) => PlexTvClientType;
  readonly createWatchTogetherClient: (
    token: string,
  ) => Pick<WatchTogetherClient, "getRoom">;
  readonly resolveAccess: ResolveGuestAccess;
};

export type GuestContinuationResult =
  | {
      readonly ok: true;
      readonly capability: string;
      readonly value: Extract<GuestBootstrapResult, { ok: true }>["value"];
    }
  | {
      readonly ok: false;
      readonly reason: GuestBootstrapFailureReason | "pending";
    };

export type GuestContinuationDependencies = Omit<
  GuestBootstrapDependencies,
  "createWatchTogetherClient"
> & {
  readonly createWatchTogetherClient: (
    token: string,
  ) => Pick<WatchTogetherClient, "deleteRoom" | "getRoom" | "listRooms">;
};

export function createGuestBootstrapService(
  dependencies: GuestBootstrapDependencies,
): (capability: string) => Promise<GuestBootstrapResult> {
  return async (capability) => {
    const verification = await dependencies.capabilityCodec.verify(capability);
    if (!verification.ok) {
      return {
        ok: false,
        reason:
          verification.reason === "expired"
            ? "expired-invite"
            : "invalid-invite",
      };
    }
    const payload = verification.payload;

    const hostToken = await dependencies.loadHostToken(payload.hostUserId);
    if (!hostToken) {
      return { ok: false, reason: "room-unavailable" };
    }

    const hostPlex = dependencies.createPlexClient(hostToken);
    let room: WatchTogetherRoom;
    try {
      room = await dependencies
        .createWatchTogetherClient(hostToken)
        .getRoom(payload.roomId);
    } catch {
      return { ok: false, reason: "room-unavailable" };
    }

    const source = parseLibraryItemUri(room.sourceUri);
    if (room.id !== payload.roomId || !source) {
      return { ok: false, reason: "room-unavailable" };
    }

    const access = await dependencies.resolveAccess(hostPlex, {
      serverId: source.serverId,
      ratingKey: source.ratingKey,
    });
    if (!access.ok) {
      return { ok: false, reason: "guest-unavailable" };
    }

    const roomUserIds = new Set(room.users.map((roomUser) => roomUser.id));
    if (
      !roomUserIds.has(access.value.hostPlexUserId) ||
      !roomUserIds.has(access.value.guest.id)
    ) {
      return { ok: false, reason: "room-unavailable" };
    }

    let transientToken: string;
    try {
      transientToken =
        await access.value.playbackServerClient.issueTransientToken();
    } catch {
      return { ok: false, reason: "guest-unavailable" };
    }

    const nextEpisode = await loadGuestNextEpisode(
      access.value.playbackServerClient,
      room.sourceUri,
      source.ratingKey,
    );

    const hostRoomUser = room.users.find(
      (roomUser) => roomUser.id === access.value.hostPlexUserId,
    );
    const guestRoomUser = room.users.find(
      (roomUser) => roomUser.id === access.value.guest.id,
    );
    if (!hostRoomUser || !guestRoomUser) {
      return { ok: false, reason: "room-unavailable" };
    }

    return {
      ok: true,
      value: {
        room: {
          id: room.id,
          sourceUri: room.sourceUri,
          title: room.title,
          type: room.type,
          syncplayHost: room.syncplayHost,
          syncplayPort: room.syncplayPort,
          users: room.users.map((roomUser) => ({
            id: roomUser.id,
            title: roomUser.title,
            username: roomUser.username,
            thumb: roomUser.thumb,
          })),
        },
        host: {
          id: hostRoomUser.id,
          title:
            hostRoomUser.title ??
            hostRoomUser.username ??
            "Watch Together host",
        },
        guest: {
          id: guestRoomUser.id,
          title: guestRoomUser.title ?? guestRoomUser.username ?? "Plex Guest",
        },
        serverId: source.serverId,
        serverUrl: access.value.playbackServerUrl,
        authToken: transientToken,
        item: access.value.item,
        nextEpisode,
      },
    };
  };
}

export function createGuestContinuationService(
  dependencies: GuestContinuationDependencies,
): (
  capability: string,
  nextRatingKey?: string,
) => Promise<GuestContinuationResult> {
  return async (capability, nextRatingKey) => {
    const verification = await dependencies.capabilityCodec.verify(capability);
    if (!verification.ok) {
      return {
        ok: false,
        reason:
          verification.reason === "expired"
            ? "expired-invite"
            : "invalid-invite",
      };
    }
    const payload = verification.payload;
    const hostToken = await dependencies.loadHostToken(payload.hostUserId);
    if (!hostToken) {
      return { ok: false, reason: "room-unavailable" };
    }

    const hostPlex = dependencies.createPlexClient(hostToken);
    const watchTogether = dependencies.createWatchTogetherClient(hostToken);
    let currentRoom: WatchTogetherRoom;
    let rooms: WatchTogetherRoom[];
    try {
      [currentRoom, rooms] = await Promise.all([
        watchTogether.getRoom(payload.roomId),
        watchTogether.listRooms(),
      ]);
    } catch {
      return { ok: false, reason: "room-unavailable" };
    }

    const currentSource = parseLibraryItemUri(currentRoom.sourceUri);
    if (currentRoom.id !== payload.roomId || !currentSource) {
      return { ok: false, reason: "room-unavailable" };
    }

    const currentAccess = await dependencies.resolveAccess(hostPlex, {
      serverId: currentSource.serverId,
      ratingKey: currentSource.ratingKey,
    });
    if (!currentAccess.ok) {
      return { ok: false, reason: "guest-unavailable" };
    }
    if (!roomContainsGuestParty(currentRoom, currentAccess.value)) {
      return { ok: false, reason: "room-unavailable" };
    }

    const nextRoom = nextRatingKey
      ? findNextEpisodeRoom({
          rooms,
          serverId: currentSource.serverId,
          nextRatingKey,
          currentRoom,
        })
      : findGuestSuccessorRoom({
          rooms,
          currentRoom,
          serverId: currentSource.serverId,
          currentRatingKey: currentSource.ratingKey,
        });
    if (!nextRoom) {
      return { ok: false, reason: "pending" };
    }
    const nextSource = parseLibraryItemUri(nextRoom.sourceUri);
    if (nextSource?.serverId !== currentSource.serverId) {
      return { ok: false, reason: "room-unavailable" };
    }
    const resolvedNextRatingKey = nextSource.ratingKey;

    const nextAccess = await dependencies.resolveAccess(hostPlex, {
      serverId: currentSource.serverId,
      ratingKey: resolvedNextRatingKey,
    });
    if (!nextAccess.ok) {
      return { ok: false, reason: "guest-unavailable" };
    }
    if (
      nextAccess.value.guest.id !== currentAccess.value.guest.id ||
      !roomContainsGuestParty(nextRoom, nextAccess.value)
    ) {
      return { ok: false, reason: "room-unavailable" };
    }

    let transientToken: string;
    try {
      transientToken =
        await nextAccess.value.playbackServerClient.issueTransientToken();
    } catch {
      return { ok: false, reason: "guest-unavailable" };
    }
    const nextEpisode = await loadGuestNextEpisode(
      nextAccess.value.playbackServerClient,
      nextRoom.sourceUri,
      resolvedNextRatingKey,
    );
    const hostRoomUser = nextRoom.users.find(
      (roomUser) => roomUser.id === nextAccess.value.hostPlexUserId,
    );
    const guestRoomUser = nextRoom.users.find(
      (roomUser) => roomUser.id === nextAccess.value.guest.id,
    );
    if (!hostRoomUser || !guestRoomUser) {
      return { ok: false, reason: "room-unavailable" };
    }

    const remainingLifetime = Math.max(
      1,
      payload.expiresAt - Math.floor(Date.now() / 1000),
    );
    const successorCapability = await dependencies.capabilityCodec.sign({
      hostUserId: payload.hostUserId,
      roomId: nextRoom.id,
      lifetimeSeconds: remainingLifetime,
    });

    await watchTogether.deleteRoom(currentRoom.id).catch(() => undefined);

    return {
      ok: true,
      capability: successorCapability,
      value: {
        room: toGuestRoom(nextRoom),
        host: {
          id: hostRoomUser.id,
          title:
            hostRoomUser.title ??
            hostRoomUser.username ??
            "Watch Together host",
        },
        guest: {
          id: guestRoomUser.id,
          title: guestRoomUser.title ?? guestRoomUser.username ?? "Plex Guest",
        },
        serverId: currentSource.serverId,
        serverUrl: nextAccess.value.playbackServerUrl,
        authToken: transientToken,
        item: nextAccess.value.item,
        nextEpisode,
      },
    };
  };
}

function findGuestSuccessorRoom(input: {
  readonly rooms: WatchTogetherRoom[];
  readonly currentRoom: WatchTogetherRoom;
  readonly serverId: string;
  readonly currentRatingKey: string;
}): WatchTogetherRoom | null {
  const currentUserIds = new Set(
    input.currentRoom.users.map((user) => user.id),
  );
  const currentTimestamp = roomTimestamp(input.currentRoom);
  const newestAllowedAgeSeconds = 30 * 60;
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const candidates = input.rooms.filter((room) => {
    if (room.id === input.currentRoom.id) return false;
    const source = parseLibraryItemUri(room.sourceUri);
    if (
      source?.serverId !== input.serverId ||
      source.ratingKey === input.currentRatingKey
    ) {
      return false;
    }
    const roomUserIds = new Set(room.users.map((user) => user.id));
    if (
      roomUserIds.size !== currentUserIds.size ||
      ![...currentUserIds].every((id) => roomUserIds.has(id))
    ) {
      return false;
    }
    const timestamp = roomTimestamp(room);
    return (
      timestamp >= currentTimestamp &&
      nowSeconds - timestamp <= newestAllowedAgeSeconds
    );
  });

  return (
    candidates.sort(
      (left, right) =>
        roomTimestamp(right) - roomTimestamp(left) ||
        right.id.localeCompare(left.id),
    )[0] ?? null
  );
}

function roomTimestamp(room: WatchTogetherRoom): number {
  return room.updatedAt ?? room.startsAt ?? 0;
}

function roomContainsGuestParty(
  room: WatchTogetherRoom,
  access: ResolvedGuestAccess,
): boolean {
  const ids = new Set(room.users.map((user) => user.id));
  return ids.has(access.hostPlexUserId) && ids.has(access.guest.id);
}

function toGuestRoom(
  room: WatchTogetherRoom,
): Extract<GuestBootstrapResult, { ok: true }>["value"]["room"] {
  return {
    id: room.id,
    sourceUri: room.sourceUri,
    title: room.title,
    type: room.type,
    syncplayHost: room.syncplayHost,
    syncplayPort: room.syncplayPort,
    users: room.users.map((roomUser) => ({
      id: roomUser.id,
      title: roomUser.title,
      username: roomUser.username,
      thumb: roomUser.thumb,
    })),
  };
}

async function loadGuestNextEpisode(
  serverClient: PlexServerClient,
  sourceUri: string,
  currentRatingKey: string,
): Promise<GuestNextEpisode | null> {
  try {
    const queue = await serverClient.createPlayQueue({
      type: "video",
      uri: sourceUri,
      continuous: true,
      includeMarkers: true,
      includeChapters: true,
      shuffle: false,
      repeat: 0,
    });
    const items = queue.MediaContainer.Metadata ?? [];
    const currentIndex = items.findIndex(
      (item) => item.ratingKey === currentRatingKey,
    );
    const next = currentIndex >= 0 ? items[currentIndex + 1] : undefined;
    return next ? toGuestNextEpisode(next) : null;
  } catch {
    return null;
  }
}

function toGuestNextEpisode(item: PlayQueueItem): GuestNextEpisode {
  return {
    ratingKey: item.ratingKey,
    key: item.key,
    title: item.title,
    index: item.index ?? 0,
    parentIndex: item.parentIndex ?? 0,
    thumb: item.thumb,
    art: item.art,
    duration: item.duration,
    summary: item.summary,
    grandparentTitle: item.grandparentTitle,
    parentTitle: item.parentTitle,
  };
}

let defaultBootstrapPromise:
  | Promise<(capability: string) => Promise<GuestBootstrapResult>>
  | undefined;
let defaultContinuationPromise:
  | Promise<
      (
        capability: string,
        nextRatingKey?: string,
      ) => Promise<GuestContinuationResult>
    >
  | undefined;

async function getDefaultBootstrap() {
  defaultBootstrapPromise ??= Promise.all([
    import("~/env"),
    import("~/server/db"),
    import("~/server/db/schema"),
  ]).then(([{ env }, { db }, { user }]) =>
    createGuestBootstrapService({
      capabilityCodec: createGuestCapabilityCodec(env.BETTER_AUTH_SECRET),
      async loadHostToken(hostUserId) {
        const rows = await db
          .select({ plexAuthToken: user.plexAuthToken })
          .from(user)
          .where(eq(user.id, hostUserId))
          .limit(1);
        return rows[0]?.plexAuthToken ?? null;
      },
      createPlexClient: (token) => new PlexTvClient(token, NEXTJS_PLEX_CONFIG),
      createWatchTogetherClient: (token) =>
        new WatchTogetherClient(token, NEXTJS_PLEX_CONFIG),
      resolveAccess: resolveGuestAccess,
    }),
  );
  return defaultBootstrapPromise;
}

export async function bootstrapGuestInvite(
  capability: string,
): Promise<GuestBootstrapResult> {
  return (await getDefaultBootstrap())(capability);
}

async function getDefaultContinuation() {
  defaultContinuationPromise ??= Promise.all([
    import("~/env"),
    import("~/server/db"),
    import("~/server/db/schema"),
  ]).then(([{ env }, { db }, { user }]) =>
    createGuestContinuationService({
      capabilityCodec: createGuestCapabilityCodec(env.BETTER_AUTH_SECRET),
      async loadHostToken(hostUserId) {
        const rows = await db
          .select({ plexAuthToken: user.plexAuthToken })
          .from(user)
          .where(eq(user.id, hostUserId))
          .limit(1);
        return rows[0]?.plexAuthToken ?? null;
      },
      createPlexClient: (token) => new PlexTvClient(token, NEXTJS_PLEX_CONFIG),
      createWatchTogetherClient: (token) =>
        new WatchTogetherClient(token, NEXTJS_PLEX_CONFIG),
      resolveAccess: resolveGuestAccess,
    }),
  );
  return defaultContinuationPromise;
}

export async function continueGuestInvite(
  capability: string,
  nextRatingKey?: string,
): Promise<GuestContinuationResult> {
  return (await getDefaultContinuation())(capability, nextRatingKey);
}
