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
  setSession: (session) =>
    set((state) => ({
      session,
      participants: {
        ...Object.fromEntries(
          session.room.users.map((user) => [
            String(user.id),
            {
              user: {
                id: user.id,
                deviceIdentifier: String(user.id),
                deviceName: user.title ?? user.username ?? "Plex user",
              },
              isPresent: false,
              isReady: false,
            },
          ]),
        ),
        ...state.participants,
      },
    })),
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
