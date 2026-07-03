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

interface ParticipantEntry {
  isPresent: boolean;
  isReady: boolean;
}

interface PendingPause {
  timer: ReturnType<typeof setTimeout>;
}

export interface WatchTogetherSessionToasts {
  handleParticipant: (participant: SyncplayParticipantState) => void;
  handleRemoteAction: (action: SyncplayRemoteAction) => void;
  dispose: () => void;
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

/**
 * Turns Syncplay session events into toasts: who paused/resumed/seeked, and who
 * joined or left the session. "In the session" means actively watching
 * (readiness, which Syncplay only sets once a member's player has loaded) — not
 * mere lobby presence, so the lobby<->player socket handoffs never produce
 * false leave/join noise, while genuine leave-and-rejoin cycles toast both
 * ways. One notifier lives per Syncplay session connection; dispose it when the
 * session ends so pending toasts don't fire after the viewer has moved on.
 */
export function createWatchTogetherSessionToasts(options: {
  room: Pick<WatchTogetherRoom, "users">;
  localUser: SyncplayUser;
}): WatchTogetherSessionToasts {
  const roomUserById = new Map(
    options.room.users.map((user) => [user.id, user]),
  );
  const startedAt = Date.now();
  const participants = new Map<string, ParticipantEntry>();
  const pendingPauses = new Map<string, PendingPause>();
  const lastActionAt = new Map<string, number>();
  let disposed = false;

  const showToast = (user: SyncplayUser | null, text: string): void => {
    const roomUser = user ? roomUserById.get(user.id) : undefined;
    const name = roomUser ? getPlexUserName(roomUser) : "Someone";
    toast(<SessionToast user={roomUser} name={name} text={text} />);
  };

  const isWatching = (entry: ParticipantEntry | undefined): boolean =>
    Boolean(entry?.isPresent && entry.isReady);

  const cancelPendingPause = (deviceIdentifier: string): void => {
    const pending = pendingPauses.get(deviceIdentifier);
    if (pending) {
      clearTimeout(pending.timer);
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
    const entry = participants.get(key);
    const wasWatching = isWatching(entry);
    const next: ParticipantEntry = entry ?? {
      isPresent: false,
      isReady: false,
    };

    if (participant.isPresent !== undefined) {
      next.isPresent = participant.isPresent;
      // Someone who isn't connected can't be watching; their readiness will be
      // re-announced if they come back.
      if (!participant.isPresent) {
        next.isReady = false;
      }
    }
    if (participant.isReady !== undefined) {
      next.isReady = participant.isReady === true;
    }
    participants.set(key, next);

    const nowWatching = isWatching(next);
    if (nowWatching === wasWatching) {
      return;
    }

    // Watchers reported while we're connecting are the room's existing state,
    // not a fresh join.
    if (
      nowWatching &&
      entry === undefined &&
      Date.now() - startedAt < INITIAL_ROSTER_SETTLE_MS
    ) {
      return;
    }

    if (nowWatching) {
      showToast(participant.user, "joined the session");
    } else {
      // Their goodbye pause is part of the leave, not a deliberate pause.
      cancelPendingPause(key);
      showToast(participant.user, "left the session");
    }
  };

  const handleRemoteAction = (action: SyncplayRemoteAction): void => {
    if (disposed) {
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
      case "seek":
        text = `jumped to ${formatTime(action.positionSeconds)}`;
        // Position is part of the key so two distinct quick seeks both toast,
        // while a re-applied identical seek doesn't.
        dedupeKey = `seek:${action.user?.id ?? "?"}:${Math.round(action.positionSeconds)}`;
        break;
      default: {
        const exhaustive: never = action.type;
        return exhaustive;
      }
    }

    const now = Date.now();
    const lastAt = lastActionAt.get(dedupeKey);
    if (lastAt !== undefined && now - lastAt < ACTION_DEDUPE_MS) {
      return;
    }
    lastActionAt.set(dedupeKey, now);

    if (action.type !== "pause" || !action.user) {
      showToast(action.user, text);
      return;
    }

    // Hold pause toasts briefly: if the author leaves within the window (they
    // closed their player, which broadcasts this pause), the leave toast
    // supersedes it.
    const user = action.user;
    const key = user.deviceIdentifier;
    cancelPendingPause(key);
    pendingPauses.set(key, {
      timer: setTimeout(() => {
        pendingPauses.delete(key);
        if (!disposed && isWatching(participants.get(key))) {
          showToast(user, text);
        }
      }, PAUSE_LEAVE_HOLD_MS),
    });
  };

  const dispose = (): void => {
    disposed = true;
    for (const pending of pendingPauses.values()) {
      clearTimeout(pending.timer);
    }
    pendingPauses.clear();
  };

  return { handleParticipant, handleRemoteAction, dispose };
}
