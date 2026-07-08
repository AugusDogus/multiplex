import {
  parseLibraryItemUri,
  type SyncplayParticipantState,
  type SyncplayUser,
  type WatchTogetherRoom,
} from "@multiplex/plex-query";

/**
 * The Syncplay device name every Multiplex client announces. Auto-advance
 * coordination (leader election, "everyone joined" checks) only counts these
 * participants: official Plex clients in the same room can't run our
 * room-rotation protocol, so they follow via the regular invite instead.
 */
export const MULTIPLEX_SYNCPLAY_DEVICE_NAME = "Multiplex Web";

/**
 * Rooms whose newest timestamp is older than this are ignored during
 * next-room discovery, so a leftover room for the same episode from an
 * earlier watch party can't hijack the rotation.
 */
const NEXT_ROOM_MAX_AGE_MS = 30 * 60 * 1000;

type ParticipantMap = Record<string, SyncplayParticipantState>;

/**
 * The Multiplex clients currently present in the session, in a deterministic
 * order (Plex user id, then device identifier). Every client computes the same
 * list from the shared Syncplay participant state, so the ordering doubles as
 * a leader election: rank 0 creates the next room, rank 1 takes over if rank 0
 * doesn't, and so on. The local user always counts as present.
 */
export function getMultiplexParticipants(
  participants: ParticipantMap,
  localUser: SyncplayUser,
): SyncplayUser[] {
  const users = new Map<string, SyncplayUser>();

  for (const participant of Object.values(participants)) {
    if (participant.user.deviceName !== MULTIPLEX_SYNCPLAY_DEVICE_NAME) {
      continue;
    }
    if (participant.isPresent !== true) {
      continue;
    }
    users.set(participant.user.deviceIdentifier, participant.user);
  }

  users.set(localUser.deviceIdentifier, localUser);

  return [...users.values()].sort(
    (a, b) =>
      a.id - b.id ||
      (a.deviceIdentifier < b.deviceIdentifier
        ? -1
        : a.deviceIdentifier > b.deviceIdentifier
          ? 1
          : 0),
  );
}

/**
 * The local client's rank in the deterministic auto-advance ordering. Rank 0
 * is the leader (creates the next room immediately); higher ranks act as
 * staggered failovers.
 */
export function getAutoAdvanceRank(
  participants: ParticipantMap,
  localUser: SyncplayUser,
): number {
  return getMultiplexParticipants(participants, localUser).findIndex(
    (user) => user.deviceIdentifier === localUser.deviceIdentifier,
  );
}

interface FindNextEpisodeRoomInput {
  rooms: WatchTogetherRoom[];
  /** Server the current session's item lives on. */
  serverId: string;
  /** Rating key of the next episode the new room must point at. */
  nextRatingKey: string;
  /** The session's current room; the next room must invite the same party. */
  currentRoom: Pick<WatchTogetherRoom, "id" | "users">;
  now?: number;
}

/**
 * Finds the room the party should rotate into for the next episode.
 *
 * The invite itself is the discovery signal: the leader creates the next room
 * inviting everyone from the current room, which makes it appear in every
 * member's own room list — no extra backend or side channel needed. A room
 * counts only if it points at the next episode on the same server, includes
 * the whole current party (so every member can discover it), and is recent.
 * Ties resolve deterministically so all clients converge on the same room
 * even if a failover raced the leader into creating a duplicate.
 */
export function findNextEpisodeRoom(
  input: FindNextEpisodeRoomInput,
): WatchTogetherRoom | null {
  const now = input.now ?? Date.now();
  const currentUserIds = input.currentRoom.users.map((user) => user.id);

  const candidates = input.rooms.filter((room) => {
    if (room.id === input.currentRoom.id) {
      return false;
    }

    const source = parseLibraryItemUri(room.sourceUri);
    if (
      source?.serverId !== input.serverId ||
      source.ratingKey !== input.nextRatingKey
    ) {
      return false;
    }

    const roomUserIds = new Set(room.users.map((user) => user.id));
    if (!currentUserIds.every((id) => roomUserIds.has(id))) {
      return false;
    }

    const timestamp = getRoomTimestampMs(room);
    if (timestamp !== null && now - timestamp > NEXT_ROOM_MAX_AGE_MS) {
      return false;
    }

    return true;
  });

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((best, room) => {
    const bestTimestamp = getRoomTimestampMs(best) ?? 0;
    const roomTimestamp = getRoomTimestampMs(room) ?? 0;
    if (roomTimestamp !== bestTimestamp) {
      return roomTimestamp > bestTimestamp ? room : best;
    }
    return room.id > best.id ? room : best;
  });
}

/**
 * Whether every Multiplex participant of the current session (besides the
 * local user) has shown up in the next room. Official Plex clients are
 * excluded — they join through the regular invite at their own pace, and the
 * swap must not wait on them.
 */
export function haveMultiplexParticipantsJoined(
  sessionParticipants: ParticipantMap,
  nextRoomParticipants: ParticipantMap,
  localUser: SyncplayUser,
): boolean {
  return getMultiplexParticipants(sessionParticipants, localUser)
    .filter((user) => user.deviceIdentifier !== localUser.deviceIdentifier)
    .every(
      (user) => nextRoomParticipants[user.deviceIdentifier]?.isPresent === true,
    );
}

/**
 * Merges a Syncplay participant update into a participant map, mirroring the
 * watch-together store's semantics: a leave replaces the entry (stale
 * readiness must not survive), and partial updates only overwrite the fields
 * they carry.
 */
export function mergeParticipantState(
  participants: ParticipantMap,
  participant: SyncplayParticipantState,
): ParticipantMap {
  const key = participant.user.deviceIdentifier;

  if (participant.isPresent === false) {
    return {
      ...participants,
      [key]: { user: participant.user, isPresent: false },
    };
  }

  return {
    ...participants,
    [key]: {
      ...participants[key],
      ...(participant.isPresent !== undefined && {
        isPresent: participant.isPresent,
      }),
      ...(participant.isReady !== undefined && {
        isReady: participant.isReady,
      }),
      ...(participant.positionSeconds !== undefined && {
        positionSeconds: participant.positionSeconds,
      }),
      ...(participant.isPaused !== undefined && {
        isPaused: participant.isPaused,
      }),
      user: participant.user,
    },
  };
}

/**
 * Room timestamps from together.plex.tv arrive as epoch numbers; normalize
 * seconds vs. milliseconds so freshness checks don't depend on the unit.
 */
function getRoomTimestampMs(
  room: Pick<WatchTogetherRoom, "startsAt" | "updatedAt">,
): number | null {
  const timestamp = room.updatedAt ?? room.startsAt;
  if (timestamp === undefined) {
    return null;
  }
  return timestamp > 1e12 ? timestamp : timestamp * 1000;
}
