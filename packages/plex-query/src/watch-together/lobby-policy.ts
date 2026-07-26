import type { SyncplayParticipantState } from "../plex/clients/syncplay-client";
import type { WatchTogetherRoom } from "../plex/schemas/watch-together-schemas";
import type { LobbyStartPolicy, ParticipantMap } from "./session-state";

/**
 * Short settle delay before auto-starting once everyone has joined, so a
 * transient presence blip doesn't launch playback prematurely.
 */
export const AUTO_START_DELAY_MS = 1_200;

/**
 * Presence flaps briefly (isPresent false→true) during the Syncplay
 * observer→driver handoff when a participant starts watching. Treat "everyone
 * joined" as sticky: true immediately, false only after sustained absence, so
 * those blips can't reset the auto-start timer.
 */
export const PRESENCE_GRACE_MS = 3_000;

/** Reconnect delay for the lobby presence observer connection. */
export const LOBBY_OBSERVER_RECONNECT_DELAY_MS = 2_000;

export type ParticipantStatus = "watching" | "inLobby" | "invited";

export type LobbyHintInput = {
  /** Everyone invited is present (debounced/sticky). */
  readonly everyonePresent: boolean;
  /** Everyone invited is present right now (undebounced). */
  readonly everyonePresentNow: boolean;
  /** Media has resolved so playback can actually begin. */
  readonly canStart: boolean;
  /** Auto-start is suppressed because this viewer already left the player. */
  readonly autoStartSuppressed: boolean;
  /** Another member has already started watching. */
  readonly someoneElseWatching: boolean;
  /** The local user is the only member of the room. */
  readonly isSoloRoom: boolean;
};

/**
 * The lobby subtitle, kept honest: it must describe what will actually happen.
 * In particular it only promises "starting playback…" when auto-start will
 * really fire — otherwise a suppressed viewer sat forever under a claim that
 * only a page refresh could resolve.
 */
export function getLobbyHint(input: LobbyHintInput): string {
  if (input.isSoloRoom) {
    return "Invite a friend to start watching together.";
  }

  const willAutoStart =
    input.everyonePresent &&
    input.everyonePresentNow &&
    input.canStart &&
    !input.autoStartSuppressed;

  if (willAutoStart) {
    return "Everyone's here — starting playback…";
  }
  if (!input.canStart) {
    return input.everyonePresent ? "Getting the stream ready…" : "Waiting for everyone to join…";
  }
  if (input.someoneElseWatching) {
    return "Someone already started watching — press Join.";
  }
  if (input.autoStartSuppressed && input.everyonePresentNow) {
    return "Press Start when you're ready to watch.";
  }
  if (input.everyonePresent) {
    return "Getting the stream ready…";
  }
  return "Waiting for everyone to join…";
}

/**
 * `isReady` is only set once a member's media player is loaded (watching).
 * Presence (`isPresent`) means they are in the lobby. The local user always
 * counts as in-lobby even before their own presence frame arrives.
 */
export function getParticipantStatus(
  participant: SyncplayParticipantState | undefined,
  isLocal: boolean,
): ParticipantStatus {
  if (participant?.isReady) {
    return "watching";
  }
  if (participant?.isPresent || isLocal) {
    return "inLobby";
  }
  return "invited";
}

/**
 * Every invited participant is present in the lobby right now. The local user
 * counts as present even before their own presence frame arrives.
 */
export function allInvitedPresent(
  room: Pick<WatchTogetherRoom, "users">,
  participants: ParticipantMap,
  localUserId: number,
): boolean {
  if (room.users.length === 0) {
    return false;
  }
  const byUserId = participantsByUserId(participants);
  return room.users.every(
    (user) => user.id === localUserId || Boolean(byUserId.get(user.id)?.isPresent),
  );
}

/** Another invited member has already started watching (`isReady`). */
export function isSomeoneElseWatching(
  room: Pick<WatchTogetherRoom, "users">,
  participants: ParticipantMap,
  localUserId: number,
): boolean {
  const byUserId = participantsByUserId(participants);
  return room.users.some(
    (user) => user.id !== localUserId && Boolean(byUserId.get(user.id)?.isReady),
  );
}

export function isSoloRoom(room: Pick<WatchTogetherRoom, "users">): boolean {
  return room.users.length <= 1;
}

export type LobbyAutoStartDecision =
  | { readonly kind: "wait" }
  | { readonly kind: "rearm" }
  | {
      readonly kind: "start";
      /** Room playhead for a late join; `null` means a fresh start (position unset). */
      readonly startPositionSeconds: number | null;
    };

export type DecideLobbyAutoStartInput = {
  readonly room: Pick<WatchTogetherRoom, "users">;
  readonly participants: ParticipantMap;
  readonly localUserId: number;
  /**
   * How long every auto-start arm condition (sticky+now present, canStart,
   * not suppressed/solo/leaving, known position when joining in progress) has
   * held continuously. Auto-start fires once this reaches
   * {@link AUTO_START_DELAY_MS}. The service resets the clock whenever any
   * arm condition drops.
   */
  readonly presentStableMs: number;
  /** Sticky everyone-present after {@link PRESENCE_GRACE_MS} scatter debounce. */
  readonly everyonePresentSticky: boolean;
  readonly autoStartSuppressed: boolean;
  readonly canStart: boolean;
  readonly leaving: boolean;
  /** Already fired auto-start for this gathering (re-armed via `rearm`). */
  readonly hasAutoStarted: boolean;
  /**
   * Latest room playhead from Syncplay State pings, or `null` if unknown.
   * Join-in-progress requires a known position so we don't reset the room to 0.
   */
  readonly roomPositionSeconds: number | null;
  /** Defaults to Plex's ordinary all-invited-present behavior. */
  readonly startPolicy?: LobbyStartPolicy;
};

/**
 * Pure lobby auto-start decision. Encodes the rules previously spread across
 * lobby effects: everyone-present (local counts), presence-stability sticky,
 * auto-start delay, fire-once-per-gathering, suppression, solo-room guard,
 * and join-in-progress position gating. Side effects are the caller's job.
 */
export function decideLobbyAutoStart(input: DecideLobbyAutoStartInput): LobbyAutoStartDecision {
  if (input.startPolicy?._tag === "HostControlled") {
    if (input.startPolicy.localRole === "Host") {
      return { kind: "wait" };
    }

    const host = participantsByUserId(input.participants).get(input.startPolicy.hostUserId);
    if (!host?.isReady) {
      return { kind: "rearm" };
    }
    if (
      !input.canStart ||
      input.autoStartSuppressed ||
      input.leaving ||
      input.hasAutoStarted ||
      input.roomPositionSeconds === null ||
      input.presentStableMs < AUTO_START_DELAY_MS
    ) {
      return { kind: "wait" };
    }
    return {
      kind: "start",
      startPositionSeconds: input.roomPositionSeconds,
    };
  }

  if (!input.everyonePresentSticky) {
    return { kind: "rearm" };
  }

  const everyoneNow = allInvitedPresent(input.room, input.participants, input.localUserId);
  const solo = isSoloRoom(input.room);
  const someoneElseWatching = isSomeoneElseWatching(
    input.room,
    input.participants,
    input.localUserId,
  );

  if (
    !everyoneNow ||
    !input.canStart ||
    input.autoStartSuppressed ||
    solo ||
    input.leaving ||
    input.hasAutoStarted
  ) {
    return { kind: "wait" };
  }

  if (someoneElseWatching && input.roomPositionSeconds === null) {
    return { kind: "wait" };
  }

  if (input.presentStableMs < AUTO_START_DELAY_MS) {
    return { kind: "wait" };
  }

  return {
    kind: "start",
    startPositionSeconds: someoneElseWatching ? input.roomPositionSeconds : null,
  };
}

/**
 * Collapse a device-keyed {@link ParticipantMap} to one row per user.
 *
 * A user may appear on multiple devices (stale absent + live present). Last
 * write wins would misclassify them; merge across devices instead:
 * present/ready if ANY device is, and prefer identity/position from a present
 * device when available.
 */
export function participantsByUserId(
  participants: ParticipantMap,
): Map<number, SyncplayParticipantState> {
  const byUserId = new Map<number, SyncplayParticipantState>();
  for (const state of Object.values(participants)) {
    const existing = byUserId.get(state.user.id);
    if (!existing) {
      byUserId.set(state.user.id, state);
      continue;
    }
    byUserId.set(state.user.id, mergeParticipantDevices(existing, state));
  }
  return byUserId;
}

function mergeParticipantDevices(
  a: SyncplayParticipantState,
  b: SyncplayParticipantState,
): SyncplayParticipantState {
  const aPresent = a.isPresent === true;
  const bPresent = b.isPresent === true;
  const isPresent = aPresent || bPresent;
  const isReady = a.isReady === true || b.isReady === true;

  const presentSide = aPresent ? a : bPresent ? b : null;
  const user = presentSide?.user ?? a.user;
  const positionSeconds = presentSide?.positionSeconds ?? a.positionSeconds ?? b.positionSeconds;
  const isPaused = presentSide?.isPaused ?? a.isPaused ?? b.isPaused;

  return {
    user,
    isPresent,
    ...(isReady ? { isReady: true } : {}),
    ...(positionSeconds !== undefined && { positionSeconds }),
    ...(isPaused !== undefined && { isPaused }),
  };
}
