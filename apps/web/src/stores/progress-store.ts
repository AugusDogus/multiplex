import { create } from "zustand";
import { devtools } from "zustand/middleware";

export interface ProgressIdentity {
  readonly serverId: string;
  readonly ratingKey: string;
}

export const getProgressIdentityKey = ({
  serverId,
  ratingKey,
}: ProgressIdentity): string => JSON.stringify([serverId, ratingKey]);

export const toProgressPercent = (
  time: number,
  duration: number,
): number | null => {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  return (time / duration) * 100;
};

interface ProgressStore {
  updatedItemsProgress: Record<string, number>;
  updateItemProgress: (
    identity: ProgressIdentity,
    progressPercent: number,
  ) => void;
  getItemProgress: (identity: ProgressIdentity) => number | undefined;
  clearItemProgress: (identity: ProgressIdentity) => void;
  clearAllProgress: () => void;
}

export const useProgressStore = create<ProgressStore>()(
  devtools(
    (set, get) => ({
      updatedItemsProgress: {},

      updateItemProgress: (identity, progressPercent) => {
        if (!Number.isFinite(progressPercent)) return;

        set((state) => ({
          updatedItemsProgress: {
            ...state.updatedItemsProgress,
            [getProgressIdentityKey(identity)]: Math.min(
              Math.max(0, progressPercent),
              100,
            ),
          },
        }));
      },

      getItemProgress: (identity) => {
        return get().updatedItemsProgress[getProgressIdentityKey(identity)];
      },

      clearItemProgress: (identity) => {
        set((state) => {
          const newProgress = { ...state.updatedItemsProgress };
          delete newProgress[getProgressIdentityKey(identity)];
          return { updatedItemsProgress: newProgress };
        });
      },

      clearAllProgress: () => {
        set({ updatedItemsProgress: {} });
      },
    }),
    {
      name: "progress-store",
    },
  ),
);
