import type {
  SyncplayParticipantState,
  SyncplayRemoteAction,
  SyncplayUser,
  WatchTogetherRoom,
} from "@multiplex/plex-query";
import { toast } from "sonner";

import { formatTime } from "~/components/media-player/utils/playback-time-utils";
import { getPlexUserName } from "~/components/watch-together/plex-user-avatar";

// Presence flaps briefly during the Syncplay observer->driver handoff (a
// participant's lobby socket closes right as their player socket opens), so a
// leave only toasts after sustained absence.
const LEAVE_TOAST_GRACE_MS = 5000;
// Participants reported right after we connect are the room's existing roster
// (delivered via the initial List), not fresh joins.
const INITIAL_ROSTER_SETTLE_MS = 5000;
// A remote play can be re-applied every State ping while our player refuses to
// start (e.g. autoplay blocked); identical repeats shouldn't stack toasts.
const ACTION_DEDUPE_MS = 3000;

interface PresenceEntry {
  isPresent: boolean;
  leaveTimer: ReturnType<typeof setTimeout> | null;
}

export interface WatchTogetherSessionToasts {
  handleParticipant: (participant: SyncplayParticipantState) => void;
  handleRemoteAction: (action: SyncplayRemoteAction) => void;
  dispose: () => void;
}

/**
 * Turns Syncplay session events into toasts: who paused/resumed/seeked, and who
 * joined or left the session. One notifier lives per Syncplay session
 * connection; dispose it when the session ends so pending leave toasts don't
 * fire after the viewer has already moved on.
 */
export function createWatchTogetherSessionToasts(options: {
  room: Pick<WatchTogetherRoom, "users">;
  localUser: SyncplayUser;
}): WatchTogetherSessionToasts {
  const nameByUserId = new Map(
    options.room.users.map((user) => [user.id, getPlexUserName(user)]),
  );
  const startedAt = Date.now();
  const presence = new Map<string, PresenceEntry>();
  const lastActionAt = new Map<string, number>();
  let disposed = false;

  const nameFor = (user: SyncplayUser | null): string => {
    if (!user) {
      return "Someone";
    }
    return nameByUserId.get(user.id) ?? "Someone";
  };

  const handleParticipant = (participant: SyncplayParticipantState): void => {
    if (
      disposed ||
      participant.isPresent === undefined ||
      participant.user.deviceIdentifier === options.localUser.deviceIdentifier
    ) {
      return;
    }

    const key = participant.user.deviceIdentifier;
    const entry = presence.get(key);
    const name = nameFor(participant.user);

    if (participant.isPresent) {
      if (entry?.leaveTimer) {
        // Rejoined within the grace window: a presence blip, not a real leave.
        clearTimeout(entry.leaveTimer);
        entry.leaveTimer = null;
        entry.isPresent = true;
        return;
      }
      if (entry?.isPresent) {
        return;
      }
      const isInitialRoster =
        !entry && Date.now() - startedAt < INITIAL_ROSTER_SETTLE_MS;
      presence.set(key, { isPresent: true, leaveTimer: null });
      if (!isInitialRoster) {
        toast(`${name} joined the session`);
      }
      return;
    }

    if (!entry?.isPresent) {
      return;
    }
    entry.isPresent = false;
    entry.leaveTimer = setTimeout(() => {
      entry.leaveTimer = null;
      if (!disposed) {
        toast(`${name} left the session`);
      }
    }, LEAVE_TOAST_GRACE_MS);
  };

  const handleRemoteAction = (action: SyncplayRemoteAction): void => {
    if (disposed) {
      return;
    }

    const name = nameFor(action.user);
    let message: string;
    let dedupeKey: string;
    switch (action.type) {
      case "pause":
        message = `${name} paused playback`;
        dedupeKey = `pause:${action.user?.id ?? "?"}`;
        break;
      case "resume":
        message = `${name} resumed playback`;
        dedupeKey = `resume:${action.user?.id ?? "?"}`;
        break;
      case "seek":
        message = `${name} jumped to ${formatTime(action.positionSeconds)}`;
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
    toast(message);
  };

  const dispose = (): void => {
    disposed = true;
    for (const entry of presence.values()) {
      if (entry.leaveTimer) {
        clearTimeout(entry.leaveTimer);
        entry.leaveTimer = null;
      }
    }
  };

  return { handleParticipant, handleRemoteAction, dispose };
}
