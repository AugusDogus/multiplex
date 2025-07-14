import { create } from "zustand";
import { devtools } from "zustand/middleware";

interface ProgressStore {
  updatedItemsProgress: Record<string, number>;
  updateItemProgress: (update: {
    ratingKey: string;
    progressPercent: number;
  }) => void;
  getItemProgress: (ratingKey: string) => number | undefined;
  clearItemProgress: (ratingKey: string) => void;
  clearAllProgress: () => void;
}

export const useProgressStore = create<ProgressStore>()(
  devtools(
    (set, get) => ({
      updatedItemsProgress: {},

      updateItemProgress: (update) => {
        set((state) => ({
          updatedItemsProgress: {
            ...state.updatedItemsProgress,
            [update.ratingKey]: update.progressPercent,
          },
        }));
      },

      getItemProgress: (ratingKey) => {
        return get().updatedItemsProgress[ratingKey];
      },

      clearItemProgress: (ratingKey) => {
        set((state) => {
          const newProgress = { ...state.updatedItemsProgress };
          delete newProgress[ratingKey];
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
