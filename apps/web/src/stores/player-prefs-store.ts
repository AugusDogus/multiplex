import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { z } from "zod";
import type { CaptionSize, PlaybackRate } from "~/types/media-player";

/**
 * Persisted UI preferences for the media player.
 *
 * Storage key and serialized shape match the legacy `media-player-store`
 * `partialize` (including nested `autoPlay.isEnabled`) so existing
 * localStorage values round-trip without a one-shot migration.
 */
export interface PlayerPrefsState {
  volume: number;
  isMuted: boolean;
  playbackRate: PlaybackRate;
  captionSize: CaptionSize;
  autoPlayEnabled: boolean;

  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (playbackRate: PlaybackRate) => void;
  setCaptionSize: (captionSize: CaptionSize) => void;
  setAutoPlayEnabled: (isEnabled: boolean) => void;
}

/** Legacy persisted JSON written by the pre-split media-player-store. */
export type LegacyPersistedPrefsInput = {
  volume?: unknown;
  isMuted?: unknown;
  playbackRate?: unknown;
  captionSize?: unknown;
  autoPlay?: { isEnabled?: unknown };
  autoPlayEnabled?: unknown;
};

const legacyPersistedPrefsSchema = z.object({
  volume: z.number().finite().optional().catch(undefined),
  isMuted: z.boolean().optional().catch(undefined),
  playbackRate: z.number().optional().catch(undefined),
  captionSize: z.string().optional().catch(undefined),
  autoPlay: z
    .object({ isEnabled: z.boolean().optional().catch(undefined) })
    .optional()
    .catch(undefined),
  autoPlayEnabled: z.boolean().optional().catch(undefined),
});

const playbackRates: readonly PlaybackRate[] = [
  0.5, 0.75, 1, 1.25, 1.5, 1.75, 2,
];
const captionSizes: readonly CaptionSize[] = [
  "small",
  "medium",
  "large",
  "extra-large",
];

export function prefsFromPersisted(
  persisted: LegacyPersistedPrefsInput | undefined,
  current: PlayerPrefsState,
): PlayerPrefsState {
  const result = legacyPersistedPrefsSchema.safeParse(persisted);
  if (!result.success) {
    return current;
  }
  const parsed = result.data;
  const volume =
    parsed.volume !== undefined
      ? Math.min(Math.max(parsed.volume, 0), 1)
      : current.volume;
  const playbackRate = playbackRates.find(
    (rate) => rate === parsed.playbackRate,
  );
  const captionSize = captionSizes.find((size) => size === parsed.captionSize);
  return {
    ...current,
    volume,
    isMuted: parsed.isMuted ?? current.isMuted,
    playbackRate: playbackRate ?? current.playbackRate,
    captionSize: captionSize ?? current.captionSize,
    autoPlayEnabled:
      parsed.autoPlay?.isEnabled ??
      parsed.autoPlayEnabled ??
      current.autoPlayEnabled,
  };
}

/** Nested shape written to localStorage — matches legacy partialize. */
export function partializePlayerPrefs(state: PlayerPrefsState) {
  return {
    volume: state.volume,
    isMuted: state.isMuted,
    playbackRate: state.playbackRate,
    captionSize: state.captionSize,
    autoPlay: {
      isEnabled: state.autoPlayEnabled,
      isCountingDown: false,
      countdownSeconds: 0,
      nextEpisode: null,
    },
  };
}

export const usePlayerPrefsStore = create<PlayerPrefsState>()(
  devtools(
    persist(
      (set) => ({
        volume: 1,
        isMuted: false,
        playbackRate: 1,
        captionSize: "medium",
        autoPlayEnabled: true,

        setVolume: (volume) => set({ volume }),
        toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),
        setPlaybackRate: (playbackRate) => set({ playbackRate }),
        setCaptionSize: (captionSize) => set({ captionSize }),
        setAutoPlayEnabled: (autoPlayEnabled) => set({ autoPlayEnabled }),
      }),
      {
        name: "media-player-storage",
        partialize: partializePlayerPrefs,
        merge: (persisted, current) => {
          const result = legacyPersistedPrefsSchema.safeParse(persisted);
          return prefsFromPersisted(
            result.success ? result.data : undefined,
            current,
          );
        },
      },
    ),
    {
      name: "player-prefs-store",
    },
  ),
);
