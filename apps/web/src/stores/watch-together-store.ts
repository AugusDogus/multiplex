import type {
  SyncplayParticipantState,
  SyncplayUser,
  WatchTogetherRoom,
} from "@multiplex/plex-query";
import { create } from "zustand";

interface WatchTogetherSession {
  room: WatchTogetherRoom;
  localUser: SyncplayUser;
}

interface WatchTogetherStore {
  session: WatchTogetherSession | null;
  participants: Record<string, SyncplayParticipantState>;
  setSession: (session: WatchTogetherSession) => void;
  clearSession: () => void;
  updateParticipant: (participant: SyncplayParticipantState) => void;
}

export const useWatchTogetherStore = create<WatchTogetherStore>()((set) => ({
  session: null,
  participants: {},
  setSession: (session) => set({ session, participants: {} }),
  clearSession: () => set({ session: null, participants: {} }),
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
