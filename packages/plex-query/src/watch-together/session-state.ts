import type { SyncplayParticipantState } from "../plex/clients/syncplay-client";
import type { WatchTogetherRoom } from "../plex/schemas/watch-together-schemas";

/**
 * Syncplay participant map keyed by device identifier. Shared by lobby
 * presence, playback binding, and rotation "everyone joined" checks.
 */
export type ParticipantMap = Record<string, SyncplayParticipantState>;

/**
 * Minimal playing-item identity the session domain needs: enough to match a
 * room's `sourceUri`, create the next room, and keep the player bound to the
 * same library item the session claims to be playing.
 *
 * Full Plex Media/Part/Stream metadata stays outside this layer (player /
 * prefetch); the domain only requires the fields rotation and syncplay
 * binding consult.
 */
export type PlayingItem = {
  readonly serverId: string;
  readonly ratingKey: string;
  readonly key: string;
  readonly title: string;
  readonly type: string;
  readonly durationSeconds?: number;
  readonly index?: number;
  readonly parentIndex?: number;
};

/**
 * Nested rotation machine that runs *while* {@link SessionState.Playing}.
 * Rotation is not a sibling of Playing — the party is still in a session.
 */
export type RotationPhase =
  | { readonly _tag: "None" }
  | { readonly _tag: "Armed" }
  | { readonly _tag: "RoomKnown"; readonly nextRoom: WatchTogetherRoom }
  | {
      readonly _tag: "Gathering";
      readonly nextRoom: WatchTogetherRoom;
      readonly gatheredDeviceIds: ReadonlySet<string>;
    };

/**
 * Watch Together session lifecycle.
 *
 * **Invariant:** there is no representable state where the session's room and
 * the playing item disagree. The rotation swap is a single transition
 * `Playing(roomA, itemN, Gathering) → Playing(roomB, itemN+1, None)` (see
 * {@link swapPlayingRoom}). The old clear-on-mismatch inference is deleted,
 * not defended.
 */
export type SessionState =
  | { readonly _tag: "Idle" }
  | {
      readonly _tag: "Lobby";
      readonly room: WatchTogetherRoom;
      readonly participants: ParticipantMap;
      readonly roomPositionSeconds: number | null;
    }
  | {
      readonly _tag: "Playing";
      readonly room: WatchTogetherRoom;
      readonly item: PlayingItem;
      readonly participants: ParticipantMap;
      readonly rotation: RotationPhase;
    };

export type IdleSession = Extract<SessionState, { _tag: "Idle" }>;
export type LobbySession = Extract<SessionState, { _tag: "Lobby" }>;
export type PlayingSession = Extract<SessionState, { _tag: "Playing" }>;

export const RotationNone: RotationPhase = { _tag: "None" };
export const RotationArmed: RotationPhase = { _tag: "Armed" };

export function rotationRoomKnown(nextRoom: WatchTogetherRoom): RotationPhase {
  return { _tag: "RoomKnown", nextRoom };
}

export function rotationGathering(
  nextRoom: WatchTogetherRoom,
  gatheredDeviceIds: ReadonlySet<string> = new Set(),
): RotationPhase {
  return { _tag: "Gathering", nextRoom, gatheredDeviceIds };
}

export const Idle: IdleSession = { _tag: "Idle" };

export function lobby(input: {
  readonly room: WatchTogetherRoom;
  readonly participants?: ParticipantMap;
  readonly roomPositionSeconds?: number | null;
}): LobbySession {
  return {
    _tag: "Lobby",
    room: input.room,
    participants: input.participants ?? {},
    roomPositionSeconds: input.roomPositionSeconds ?? null,
  };
}

export function playing(input: {
  readonly room: WatchTogetherRoom;
  readonly item: PlayingItem;
  readonly participants?: ParticipantMap;
  readonly rotation?: RotationPhase;
}): PlayingSession {
  return {
    _tag: "Playing",
    room: input.room,
    item: input.item,
    participants: input.participants ?? {},
    rotation: input.rotation ?? RotationNone,
  };
}

/**
 * Atomic room+item swap that preserves the key invariant: the new Playing
 * state always pairs `nextRoom` with `nextItem` and resets rotation to None.
 */
export function swapPlayingRoom(
  _state: PlayingSession,
  nextRoom: WatchTogetherRoom,
  nextItem: PlayingItem,
  participants: ParticipantMap = {},
): PlayingSession {
  return {
    _tag: "Playing",
    room: nextRoom,
    item: nextItem,
    participants,
    rotation: RotationNone,
  };
}

export function isIdle(state: SessionState): state is IdleSession {
  return state._tag === "Idle";
}

export function isLobby(state: SessionState): state is LobbySession {
  return state._tag === "Lobby";
}

export function isPlaying(state: SessionState): state is PlayingSession {
  return state._tag === "Playing";
}

export function isRotationNone(
  phase: RotationPhase,
): phase is Extract<RotationPhase, { _tag: "None" }> {
  return phase._tag === "None";
}

export function isRotationArmed(
  phase: RotationPhase,
): phase is Extract<RotationPhase, { _tag: "Armed" }> {
  return phase._tag === "Armed";
}

export function isRotationRoomKnown(
  phase: RotationPhase,
): phase is Extract<RotationPhase, { _tag: "RoomKnown" }> {
  return phase._tag === "RoomKnown";
}

export function isRotationGathering(
  phase: RotationPhase,
): phase is Extract<RotationPhase, { _tag: "Gathering" }> {
  return phase._tag === "Gathering";
}

/** Next room known to the rotation machine, if any. */
export function rotationNextRoom(phase: RotationPhase): WatchTogetherRoom | null {
  switch (phase._tag) {
    case "None":
    case "Armed":
      return null;
    case "RoomKnown":
    case "Gathering":
      return phase.nextRoom;
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}
