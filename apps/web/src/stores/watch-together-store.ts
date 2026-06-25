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
    set((state) => ({
      participants: {
        ...state.participants,
        [participant.user.deviceIdentifier]: {
          ...state.participants[participant.user.deviceIdentifier],
          ...participant,
          user: participant.user,
        },
      },
    })),
}));
