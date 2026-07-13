import type {
  SyncplayParticipantState,
  SyncplayRemoteAction,
  SyncplayUser,
  WatchTogetherRoom,
  WatchTogetherUser,
} from "@multiplex/plex-query";
import { toast } from "sonner";

import { formatTime } from "~/components/media-player/utils/playback-time-utils";
import {
  getPlexUserName,
  PlexUserAvatar,
} from "~/components/watch-together/plex-user-avatar";

// Participants reported right after we connect (via the initial List) are the
// session's starting cohort, not fresh joins — their later ready-up is just
// their player finishing its (possibly slow) transcode load, so it must not
// toast no matter how long it takes.
const STARTING_COHORT_WINDOW_MS = 5000;

interface ParticipantEntry {
  isPresent: boolean;
  isReady: boolean;
  // Whether we've told the local user this participant is in the session.
  // Stays true through ready flaps (buffering after a seek) so only a real
  // connection loss toasts a leave, and only a genuine (re)join toasts a join.
  announcedWatching: boolean;
  // Part of the session's starting cohort (seen while we were connecting,
  // before local playback started, or seeded from the prior lobby/room).
  // Their first ready-up is the session starting, not a join. Cleared once
  // they genuinely leave, so a later rejoin toasts.
  isStartingCohort: boolean;
}

export interface WatchTogetherSessionToasts {
  handleParticipant: (participant: SyncplayParticipantState) => void;
  handleRemoteAction: (action: SyncplayRemoteAction) => void;
  /**
   * Report that the local player has become ready to play. Until then, remote
   * playstate edges are the session spinning up (the first loader claiming
   * play against the lobby's paused baseline), not deliberate actions.
   */
  noteLocalStarted: () => void;
  dispose: () => void;
}

export interface WatchTogetherSessionToastsOptions {
  room: Pick<WatchTogetherRoom, "users">;
  localUser: SyncplayUser;
  /**
   * Device identifiers already known from the lobby (or prior room before an
   * episode swap). Seeded as starting cohort so a slow Syncplay driver
   * handoff does not toast "joined" ~tens of seconds into playback.
   */
  initialCohortDeviceIds?: ReadonlySet<string>;
  /**
   * When true, suppress join/leave toasts only. Used while rotation is armed
   * so peers disconnecting from the current Syncplay room before the swap do
   * not look like they left the party. Pause/resume/seek still toast.
   */
  isPresenceHandoff?: () => boolean;
  /** Test seams; production uses sonner and the real clock. */
  showToast?: (
    user: WatchTogetherUser | undefined,
    name: string,
    text: string,
  ) => void;
  now?: () => number;
}

function SessionToast({
  user,
  name,
  text,
}: {
  user: WatchTogetherUser | undefined;
  name: string;
  text: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <PlexUserAvatar
        user={user ?? { title: name }}
        className="size-7 shrink-0"
      />
      <span>
        <span className="font-medium">{name}</span> {text}
      </span>
    </div>
  );
}

function showSessionToast(
  user: WatchTogetherUser | undefined,
  name: string,
  text: string,
): void {
  toast(<SessionToast user={user} name={name} text={text} />);
}

/**
 * Turns Syncplay session events into toasts, mirroring the official Plex
 * client's notifications: who paused/resumed/seeked (attributed via the
 * protocol's `setBy` edges, reported by {@link SyncplayClient.onRemoteAction})
 * and who joined or left the session.
 *
 * "In the session" means actively watching (readiness, which Syncplay only
 * sets once a member's player has loaded) — not mere lobby presence — so the
 * lobby<->player socket handoffs never produce false noise. A leave only
 * toasts on a real connection loss; readiness flaps while connected are
 * buffering (e.g. every transcoded seek reloads the stream) and stay silent.
 *
 * One notifier lives per Syncplay session connection; dispose it when the
 * session ends so events from a dying connection can't toast after the viewer
 * has moved on.
 */
export function createWatchTogetherSessionToasts(
  options: WatchTogetherSessionToastsOptions,
): WatchTogetherSessionToasts {
  const showToast = options.showToast ?? showSessionToast;
  const now = options.now ?? Date.now;
  const isPresenceHandoff = options.isPresenceHandoff ?? (() => false);
  const initialCohort = options.initialCohortDeviceIds ?? new Set<string>();

  const roomUserById = new Map(
    options.room.users.map((user) => [user.id, user]),
  );
  const startedAt = now();
  const participants = new Map<string, ParticipantEntry>();
  let localStarted = false;
  let disposed = false;

  const emit = (
    user: SyncplayUser | null,
    text: string,
    kind: "presence" | "playstate",
  ): void => {
    if (kind === "presence" && isPresenceHandoff()) {
      return;
    }
    const roomUser = user ? roomUserById.get(user.id) : undefined;
    const name = roomUser ? getPlexUserName(roomUser) : "Someone";
    showToast(roomUser, name, text);
  };

  const isWatching = (entry: ParticipantEntry | undefined): boolean =>
    Boolean(entry?.isPresent && entry.isReady);

  const handleParticipant = (participant: SyncplayParticipantState): void => {
    if (
      disposed ||
      participant.user.deviceIdentifier === options.localUser.deviceIdentifier
    ) {
      return;
    }

    const key = participant.user.deviceIdentifier;
    const entry: ParticipantEntry = participants.get(key) ?? {
      isPresent: false,
      isReady: false,
      announcedWatching: false,
      // Starting cohort if: seeded from lobby/prior room, first seen during
      // the connect window, or first seen before local playback has started
      // (peer still completing the lobby→driver Syncplay handoff).
      isStartingCohort:
        initialCohort.has(key) ||
        now() - startedAt < STARTING_COHORT_WINDOW_MS ||
        !localStarted,
    };
    const wasPresent = entry.isPresent;

    if (participant.isPresent !== undefined) {
      entry.isPresent = participant.isPresent;
      // Someone who isn't connected can't be watching; their readiness will be
      // re-announced if they come back.
      if (!participant.isPresent) {
        entry.isReady = false;
      }
    }
    if (participant.isReady !== undefined) {
      entry.isReady = participant.isReady === true;
    }
    participants.set(key, entry);

    if (isWatching(entry) && !entry.announcedWatching) {
      entry.announcedWatching = true;
      // The starting cohort becoming ready is the session starting (their
      // player finished loading), not a fresh join.
      if (!entry.isStartingCohort) {
        emit(participant.user, "joined the session", "presence");
      }
      return;
    }

    // Only a real connection loss is a leave; a ready flap while connected is
    // buffering and stays silent. (The lobby<->player socket handoff is a
    // presence blip too, but it happens before anyone is announced, so it
    // can't toast — and it must not clear the cohort flag, hence the
    // announced guard.)
    if (!entry.isPresent && wasPresent && entry.announcedWatching) {
      entry.announcedWatching = false;
      entry.isStartingCohort = false;
      emit(participant.user, "left the session", "presence");
    }
  };

  const handleRemoteAction = (action: SyncplayRemoteAction): void => {
    // Until our own player has started, playstate edges are session spin-up
    // (the first loader claims play against the lobby's paused baseline), not
    // deliberate actions.
    if (disposed || !localStarted) {
      return;
    }

    switch (action.type) {
      case "pause":
        emit(action.user, "paused playback", "playstate");
        return;
      case "resume":
        emit(action.user, "resumed playback", "playstate");
        return;
      case "seek":
        emit(
          action.user,
          `jumped to ${formatTime(action.positionSeconds)}`,
          "playstate",
        );
        return;
      default: {
        const exhaustive: never = action.type;
        return exhaustive;
      }
    }
  };

  const noteLocalStarted = (): void => {
    localStarted = true;
  };

  const dispose = (): void => {
    disposed = true;
  };

  return { handleParticipant, handleRemoteAction, noteLocalStarted, dispose };
}
