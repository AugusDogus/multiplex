import type {
  SyncplayParticipantState,
  SyncplayUser,
  WatchTogetherRoom,
} from "@multiplex/plex-query";
import { create } from "zustand";

/**
 * Transitional read model; written only by WatchTogetherSession (playing path)
 * and lobby presence (lobby path); removed in phases 3–4.
 *
 * Playing-path writers: `WatchTogetherSession` mirrors Idle/Playing into
 * `setSession` / `clearSession` / `leaveSession` / `updateParticipant`.
 * Lobby-path writer: `use-watch-together-lobby-presence` still calls
 * `updateParticipant` directly (different lifetime, same merge function).
 */
interface WatchTogetherSession {
  room: WatchTogetherRoom;
  localUser: SyncplayUser;
}

interface WatchTogetherStore {
  session: WatchTogetherSession | null;
  participants: Record<string, SyncplayParticipantState>;
  /**
   * Room the local user deliberately left (closed the player) while it was
   * still live. The lobby must not auto-start this room again — clearing the
   * participants on leave resets the lobby's "everyone joined" tracking, which
   * would otherwise re-arm auto-start and drag the user straight back into
   * playback. Cleared when a new session starts (e.g. pressing Start).
   */
  autoStartSuppressedRoomId: string | null;
  /** @internal Playing-path mirror — prefer `sessionCommands` from app code. */
  setSession: (session: WatchTogetherSession) => void;
  /**
   * Tear down the session without suppressing auto-start. Use for involuntary
   * teardowns (fatal Syncplay errors) so a transient failure doesn't get
   * mistaken for the user deliberately leaving.
   *
   * @internal Playing-path mirror — prefer `sessionCommands.leave`.
   */
  clearSession: () => void;
  /**
   * The local user deliberately left the current session (closed the player),
   * so suppress auto-start for that room before clearing it.
   *
   * @internal Playing-path mirror — prefer `sessionCommands.leave`.
   */
  leaveSession: () => void;
  /**
   * Merge a participant update. Written by WatchTogetherSession while Playing,
   * and by lobby presence while in the lobby (same merge; different lifetime).
   */
  updateParticipant: (participant: SyncplayParticipantState) => void;
}

export const useWatchTogetherStore = create<WatchTogetherStore>()((set) => ({
  session: null,
  participants: {},
  autoStartSuppressedRoomId: null,
  setSession: (session) =>
    set({ session, participants: {}, autoStartSuppressedRoomId: null }),
  clearSession: () => set({ session: null, participants: {} }),
  leaveSession: () =>
    set((state) => ({
      session: null,
      participants: {},
      autoStartSuppressedRoomId:
        state.session?.room.id ?? state.autoStartSuppressedRoomId,
    })),
  updateParticipant: (participant) =>
    set((state) => {
      const key = participant.user.deviceIdentifier;

      // A leave only carries `isPresent: false`. Someone who isn't present
      // can't be ready/watching either, so replace their state instead of
      // merging — otherwise a stale `isReady: true` would survive and keep
      // showing them as "watching" (and keep the "someone is watching" hint up)
      // after they've disconnected.
      if (participant.isPresent === false) {
        return {
          participants: {
            ...state.participants,
            [key]: { user: participant.user, isPresent: false },
          },
        };
      }

      return {
        participants: {
          ...state.participants,
          [key]: {
            ...state.participants[key],
            // Merge only fields that are actually provided. Syncplay sends
            // partial `Set` updates (e.g. a file/readiness change) that omit
            // presence; spreading them blindly would clobber `isPresent`
            // learned from the room list and flip a present member back to
            // "Invited".
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
        },
      };
    }),
}));
