import type { SyncplayParticipantState, SyncplayUser } from "../plex/clients/syncplay-client";
import type { WatchTogetherRoom } from "../plex/schemas/watch-together-schemas";
import { parseLibraryItemUri } from "../plex/utils/metadata-utils";
import type { ParticipantMap, RotationPhase } from "./session-state";

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

/**
 * How early (seconds remaining) the rotation protocol arms: the leader
 * creates the next room and everyone starts looking for it, so it's ready
 * well before the credits finish.
 */
export const ADVANCE_LEAD_SECONDS = 45;

/**
 * Ignore the first moments of playback, where duration/position aren't
 * settled yet (mirrors the solo autoplay guard).
 */
export const MIN_PLAYBACK_SECONDS = 5;

/** "Effectively at the end" threshold, same as solo autoplay. */
export const END_THRESHOLD_SECONDS = 0.5;

/**
 * Rank 0 waits this long before creating, so the first discovery poll can
 * surface a room another client already created (e.g. we armed late).
 */
export const CREATE_BASE_DELAY_MS = 1_500;

/**
 * Per-rank delay before a failover candidate creates the room itself. Must
 * comfortably exceed the discovery poll, so a failover only fires when the
 * leader genuinely didn't deliver.
 */
export const CREATE_STAGGER_MS = 8_000;

/**
 * After the episode ends, how long to wait for the rest of the party to
 * appear in the next room before swapping anyway (a stuck participant must
 * not strand everyone on the end screen).
 */
export const EVERYONE_JOINED_GRACE_MS = 10_000;

/** Room-list polling cadence while looking for the next room. */
export const DISCOVERY_POLL_MS = 4_000;

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
export function getAutoAdvanceRank(participants: ParticipantMap, localUser: SyncplayUser): number {
  return getMultiplexParticipants(participants, localUser).findIndex(
    (user) => user.deviceIdentifier === localUser.deviceIdentifier,
  );
}

export interface FindNextEpisodeRoomInput {
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
export function findNextEpisodeRoom(input: FindNextEpisodeRoomInput): WatchTogetherRoom | null {
  const now = input.now ?? Date.now();
  const currentUserIds = input.currentRoom.users.map((user) => user.id);

  const candidates = input.rooms.filter((room) => {
    if (room.id === input.currentRoom.id) {
      return false;
    }

    const source = parseLibraryItemUri(room.sourceUri);
    if (source?.serverId !== input.serverId || source.ratingKey !== input.nextRatingKey) {
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
    .every((user) => nextRoomParticipants[user.deviceIdentifier]?.isPresent === true);
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

/** Rank-staggered delay before this client should attempt room creation. */
export function createRoomDelayMs(rank: number): number {
  return CREATE_BASE_DELAY_MS + rank * CREATE_STAGGER_MS;
}

export function isInLeadWindow(input: {
  readonly durationSeconds: number;
  readonly currentTimeSeconds: number;
  readonly timeRemainingSeconds: number;
}): boolean {
  return (
    input.durationSeconds > 0 &&
    input.currentTimeSeconds > MIN_PLAYBACK_SECONDS &&
    input.timeRemainingSeconds >= 0 &&
    input.timeRemainingSeconds <= ADVANCE_LEAD_SECONDS
  );
}

export function isAtEnd(input: {
  readonly durationSeconds: number;
  readonly timeRemainingSeconds: number;
}): boolean {
  return input.durationSeconds > 0 && input.timeRemainingSeconds <= END_THRESHOLD_SECONDS;
}

/**
 * Pure decision for one tick of the auto-advance rotation machine.
 *
 * Encodes the transition rules currently spread across the five effects in
 * `use-watch-together-auto-advance`: arm latch, discovery adopt/replace,
 * rank-staggered creation, gathering-at-end, and everyone-joined-or-grace swap.
 * Side effects (timers, API calls, observer sockets) are the caller's job —
 * this only says *what* should happen next.
 */
export type RotationDecision =
  | { readonly kind: "wait" }
  | { readonly kind: "arm" }
  | { readonly kind: "create_room"; readonly afterMs: number }
  | { readonly kind: "adopt_room"; readonly room: WatchTogetherRoom }
  | { readonly kind: "begin_gathering" }
  | { readonly kind: "swap" }
  | { readonly kind: "disabled" };

export type DecideRotationInput = {
  readonly phase: RotationPhase;
  readonly timeRemainingSeconds: number;
  readonly durationSeconds: number;
  readonly currentTimeSeconds: number;
  readonly rank: number;
  readonly visibleRooms: ReadonlyArray<WatchTogetherRoom>;
  readonly everyoneJoined: boolean;
  readonly graceElapsed: boolean;
  readonly autoPlayEnabled: boolean;
  /** Server the current session's item lives on (for discovery matching). */
  readonly serverId: string;
  /** Rating key of the next episode the new room must point at. */
  readonly nextRatingKey: string;
  /** The session's current room; the next room must invite the same party. */
  readonly currentRoom: Pick<WatchTogetherRoom, "id" | "users">;
  /**
   * When true, this client has already scheduled/fired a create attempt for
   * the current armed cycle (mirrors `hasAttemptedCreateRef` in the hook).
   * Cleared by the service on arm / adopt / cycle reset.
   */
  readonly hasAttemptedCreate?: boolean;
  /** Clock for room freshness; defaults to `Date.now()`. */
  readonly now?: number;
};

export function decideRotation(input: DecideRotationInput): RotationDecision {
  if (!input.autoPlayEnabled) {
    return { kind: "disabled" };
  }

  const inLeadWindow = isInLeadWindow({
    durationSeconds: input.durationSeconds,
    currentTimeSeconds: input.currentTimeSeconds,
    timeRemainingSeconds: input.timeRemainingSeconds,
  });
  const atEnd = isAtEnd({
    durationSeconds: input.durationSeconds,
    timeRemainingSeconds: input.timeRemainingSeconds,
  });

  const discovered = findNextEpisodeRoom({
    rooms: [...input.visibleRooms],
    serverId: input.serverId,
    nextRatingKey: input.nextRatingKey,
    currentRoom: input.currentRoom,
    now: input.now,
  });

  switch (input.phase._tag) {
    case "None": {
      // Arm is latched by the phase itself: once Armed/RoomKnown/Gathering,
      // seeking back out of the lead window must not disarm (no transition
      // back to None from those phases via this decision).
      if (inLeadWindow) {
        return { kind: "arm" };
      }
      return { kind: "wait" };
    }
    case "Armed": {
      if (discovered) {
        return { kind: "adopt_room", room: discovered };
      }
      if (input.rank >= 0 && input.hasAttemptedCreate !== true) {
        return { kind: "create_room", afterMs: createRoomDelayMs(input.rank) };
      }
      return { kind: "wait" };
    }
    case "RoomKnown": {
      // Discovery keeps re-evaluating: adopting a different deterministic
      // winner replaces the known room (caller resets gathering/grace).
      if (discovered && discovered.id !== input.phase.nextRoom.id) {
        return { kind: "adopt_room", room: discovered };
      }
      // Gathering only at end — joining the next lobby early would let an
      // official client's lobby auto-start while this party is still finishing.
      if (atEnd) {
        return { kind: "begin_gathering" };
      }
      return { kind: "wait" };
    }
    case "Gathering": {
      if (discovered && discovered.id !== input.phase.nextRoom.id) {
        return { kind: "adopt_room", room: discovered };
      }
      // Swap when everyone joined OR grace elapsed (grace runs from
      // room-known-at-end — the service starts the timer on begin_gathering /
      // RoomKnown+atEnd, matching the hook).
      if (!atEnd) {
        return { kind: "wait" };
      }
      if (input.everyoneJoined || input.graceElapsed) {
        return { kind: "swap" };
      }
      return { kind: "wait" };
    }
    default: {
      const _exhaustive: never = input.phase;
      return _exhaustive;
    }
  }
}
