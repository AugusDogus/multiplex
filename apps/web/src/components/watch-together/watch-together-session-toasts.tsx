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

// Participants reported right after we connect are the room's existing roster
// (delivered via the initial List), not fresh joins.
const INITIAL_ROSTER_SETTLE_MS = 5000;
// A remote play can be re-applied every State ping while our player refuses to
// start (e.g. autoplay blocked); identical repeats shouldn't stack toasts.
const ACTION_DEDUPE_MS = 3000;
// A viewer who closes their player broadcasts a claimed pause right before
// disconnecting, so the pause and the leave arrive as a pair. Hold pause
// toasts briefly and drop them when the author leaves, so the pair reads as a
// single "left the session" (their leave is what paused the room).
const PAUSE_LEAVE_HOLD_MS = 1500;
// Seeking a transcoded stream reloads it at a new offset, which makes every
// player buffer and mechanically claim pause (stream unload) and play (stream
// ready) around the seek. Those claims sync the room correctly but aren't
// deliberate user actions, so pause/resume toasts stay quiet around seeks...
const SEEK_SETTLE_MS = 8000;
// ...and for a beat after a buffering participant becomes ready again, which is
// when their trailing mechanical "resumed" claim lands.
const READY_SETTLE_MS = 5000;

interface ParticipantEntry {
  isPresent: boolean;
  isReady: boolean;
  // Whether we've told the local user this participant is in the session.
  // Stays true through ready flaps (buffering) so only a real connection loss
  // toasts a leave, and only a genuine (re)join toasts a join.
  announcedWatching: boolean;
}

interface PendingPause {
  timer: ReturnType<typeof setTimeout>;
}

export interface WatchTogetherSessionToasts {
  handleParticipant: (participant: SyncplayParticipantState) => void;
  handleRemoteAction: (action: SyncplayRemoteAction) => void;
  /**
   * Report a local seek so the mechanical pause/resume churn it causes in the
   * room (peers reload their streams too) doesn't surface as toasts.
   */
  noteLocalSeek: () => void;
  dispose: () => void;
}

export interface WatchTogetherSessionToastsOptions {
  room: Pick<WatchTogetherRoom, "users">;
  localUser: SyncplayUser;
  /** Test seams; production uses sonner and real timers. */
  showToast?: (
    user: WatchTogetherUser | undefined,
    name: string,
    text: string,
  ) => void;
  now?: () => number;
  setTimeout?: (
    callback: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timeout: ReturnType<typeof setTimeout>) => void;
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
 * Turns Syncplay session events into toasts: who paused/resumed/seeked, and who
 * joined or left the session.
 *
 * "In the session" means actively watching (readiness, which Syncplay only
 * sets once a member's player has loaded) — not mere lobby presence — so the
 * lobby<->player socket handoffs never produce false noise. A leave only
 * toasts on a real connection loss; readiness flaps while connected are
 * buffering (e.g. every transcoded seek reloads the stream) and stay silent,
 * as do the mechanical pause/resume claims that surround them.
 *
 * One notifier lives per Syncplay session connection; dispose it when the
 * session ends so pending toasts don't fire after the viewer has moved on.
 */
export function createWatchTogetherSessionToasts(
  options: WatchTogetherSessionToastsOptions,
): WatchTogetherSessionToasts {
  const showToast = options.showToast ?? showSessionToast;
  const now = options.now ?? Date.now;
  const setTimer =
    options.setTimeout ??
    ((callback: () => void, ms: number) => globalThis.setTimeout(callback, ms));
  const clearTimer =
    options.clearTimeout ??
    ((timeout: ReturnType<typeof setTimeout>) =>
      globalThis.clearTimeout(timeout));

  const roomUserById = new Map(
    options.room.users.map((user) => [user.id, user]),
  );
  const startedAt = now();
  const participants = new Map<string, ParticipantEntry>();
  const pendingPauses = new Map<string, PendingPause>();
  const lastActionAt = new Map<string, number>();
  // Playstate (pause/resume) toasts are muted until this time; extended by
  // seeks and by participants finishing buffering.
  let playstateQuietUntil = 0;
  let disposed = false;

  const emit = (user: SyncplayUser | null, text: string): void => {
    const roomUser = user ? roomUserById.get(user.id) : undefined;
    const name = roomUser ? getPlexUserName(roomUser) : "Someone";
    showToast(roomUser, name, text);
  };

  const isWatching = (entry: ParticipantEntry | undefined): boolean =>
    Boolean(entry?.isPresent && entry.isReady);

  // Someone in the session is mid-buffer (their trailing mechanical playstate
  // claims are still coming), or a seek/ready-up happened moments ago.
  const playstateQuiet = (): boolean => {
    if (now() < playstateQuietUntil) {
      return true;
    }
    for (const entry of participants.values()) {
      if (entry.announcedWatching && entry.isPresent && !entry.isReady) {
        return true;
      }
    }
    return false;
  };

  const cancelPendingPause = (deviceIdentifier: string): void => {
    const pending = pendingPauses.get(deviceIdentifier);
    if (pending) {
      clearTimer(pending.timer);
      pendingPauses.delete(deviceIdentifier);
    }
  };

  const handleParticipant = (participant: SyncplayParticipantState): void => {
    if (
      disposed ||
      participant.user.deviceIdentifier === options.localUser.deviceIdentifier
    ) {
      return;
    }

    const key = participant.user.deviceIdentifier;
    const existing = participants.get(key);
    const entry: ParticipantEntry = existing ?? {
      isPresent: false,
      isReady: false,
      announcedWatching: false,
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
      const nextReady = participant.isReady === true;
      if (entry.announcedWatching && !entry.isReady && nextReady) {
        // Finished buffering: their mechanical "resumed" claim lands shortly.
        playstateQuietUntil = Math.max(
          playstateQuietUntil,
          now() + READY_SETTLE_MS,
        );
      }
      entry.isReady = nextReady;
    }
    participants.set(key, entry);

    if (isWatching(entry) && !entry.announcedWatching) {
      entry.announcedWatching = true;
      // Watchers reported while we're connecting are the room's existing
      // state, not a fresh join.
      if (now() - startedAt >= INITIAL_ROSTER_SETTLE_MS) {
        emit(participant.user, "joined the session");
      }
      return;
    }

    // Only a real connection loss is a leave; a ready flap while connected is
    // buffering and stays silent.
    if (!entry.isPresent && wasPresent && entry.announcedWatching) {
      entry.announcedWatching = false;
      // Their goodbye pause is part of the leave, not a deliberate pause.
      cancelPendingPause(key);
      emit(participant.user, "left the session");
    }
  };

  const handleRemoteAction = (action: SyncplayRemoteAction): void => {
    if (disposed) {
      return;
    }

    if (action.type === "seek") {
      playstateQuietUntil = Math.max(
        playstateQuietUntil,
        now() + SEEK_SETTLE_MS,
      );
      const dedupeKey = `seek:${action.user?.id ?? "?"}:${Math.round(action.positionSeconds)}`;
      const lastAt = lastActionAt.get(dedupeKey);
      if (lastAt !== undefined && now() - lastAt < ACTION_DEDUPE_MS) {
        return;
      }
      lastActionAt.set(dedupeKey, now());
      emit(action.user, `jumped to ${formatTime(action.positionSeconds)}`);
      return;
    }

    // Pause/resume around seeks and buffering are mechanical stream-reload
    // churn, not deliberate actions.
    if (playstateQuiet()) {
      return;
    }

    let text: string;
    let dedupeKey: string;
    switch (action.type) {
      case "pause":
        text = "paused playback";
        dedupeKey = `pause:${action.user?.id ?? "?"}`;
        break;
      case "resume":
        text = "resumed playback";
        dedupeKey = `resume:${action.user?.id ?? "?"}`;
        break;
      default: {
        const exhaustive: never = action.type;
        return exhaustive;
      }
    }

    const lastAt = lastActionAt.get(dedupeKey);
    if (lastAt !== undefined && now() - lastAt < ACTION_DEDUPE_MS) {
      return;
    }
    lastActionAt.set(dedupeKey, now());

    if (action.type !== "pause" || !action.user) {
      emit(action.user, text);
      return;
    }

    // Hold pause toasts briefly: if the author leaves within the window (they
    // closed their player, which broadcasts this pause), the leave toast
    // supersedes it.
    const user = action.user;
    const key = user.deviceIdentifier;
    cancelPendingPause(key);
    pendingPauses.set(key, {
      timer: setTimer(() => {
        pendingPauses.delete(key);
        if (
          !disposed &&
          isWatching(participants.get(key)) &&
          !playstateQuiet()
        ) {
          emit(user, text);
        }
      }, PAUSE_LEAVE_HOLD_MS),
    });
  };

  const noteLocalSeek = (): void => {
    playstateQuietUntil = Math.max(playstateQuietUntil, now() + SEEK_SETTLE_MS);
  };

  const dispose = (): void => {
    disposed = true;
    for (const pending of pendingPauses.values()) {
      clearTimer(pending.timer);
    }
    pendingPauses.clear();
  };

  return { handleParticipant, handleRemoteAction, noteLocalSeek, dispose };
}
