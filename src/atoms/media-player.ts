import { atom } from "jotai";
import type { MediaPlayerItem, MediaPlayerState } from "~/types/media-player";

/* ────────────────────────────────────────────────────────────
   Media Player Jotai Atoms
   Atomic state management for the media player
   ──────────────────────────────────────────────────────────── */

/**
 * Base state atom containing all media player state
 */
export const mediaPlayerStateAtom = atom<MediaPlayerState>({
  // Modal state
  isOpen: false,
  currentItem: null,

  // Play queue state
  playQueue: null,
  playQueueId: null,
  markers: [],

  // Playback state
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  bufferedTime: 0,

  // Audio state
  volume: 1,
  isMuted: false,

  // UI state
  isFullscreen: false,
  showControls: true,
  controlsTimeout: null,

  // Loading/Error state
  isLoading: false,
  error: null,

  // Video element state
  canPlay: false,
  isBuffering: false,
});

/**
 * Write-only atom to open the media player with an item
 */
export const openMediaPlayerAtom = atom(
  null,
  (get, set, item: MediaPlayerItem) => {
    // Check if we have updated progress for this item
    const updatedProgress = get(updatedItemsProgressAtom);
    const updatedProgressPercent = updatedProgress[item.ratingKey];

    // Calculate initial currentTime using updated progress if available
    const initialCurrentTime =
      updatedProgressPercent !== undefined && item.duration
        ? (updatedProgressPercent / 100) * (item.duration / 1000)
        : Math.floor(item.viewOffset ?? 0) / 1000;

    set(mediaPlayerStateAtom, (prev) => ({
      ...prev,
      isOpen: true,
      currentItem: item,
      isLoading: true,
      error: null,
      currentTime: initialCurrentTime,
      // Reset playback state
      isPlaying: false,
      duration: 0,
      bufferedTime: 0,
      canPlay: false,
      isBuffering: false,
    }));
  },
);

/**
 * Write-only atom to close the media player and reset state
 */
export const closeMediaPlayerAtom = atom(null, (get, set) => {
  const state = get(mediaPlayerStateAtom);

  // Clear any timeouts
  if (state.controlsTimeout) {
    clearTimeout(state.controlsTimeout);
  }

  set(mediaPlayerStateAtom, (prev) => ({
    ...prev,
    isOpen: false,
    currentItem: null,
    playQueue: null,
    playQueueId: null,
    markers: [],
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    bufferedTime: 0,
    isLoading: false,
    error: null,
    canPlay: false,
    isBuffering: false,
    controlsTimeout: null,
    // Keep UI preferences
    showControls: true,
    isFullscreen: false,
  }));
});

/**
 * Write-only atom to update playback state
 */
export const updatePlaybackStateAtom = atom(
  null,
  (get, set, updates: Partial<MediaPlayerState>) => {
    set(mediaPlayerStateAtom, (prev) => ({
      ...prev,
      ...updates,
    }));
  },
);

/**
 * Atom to track progress updates for items that have been played this session
 */
export const updatedItemsProgressAtom = atom<Record<string, number>>({});

/**
 * Write-only atom to update an item's progress
 */
export const updateItemProgressAtom = atom(
  null,
  (get, set, update: { ratingKey: string; progressPercent: number }) => {
    set(updatedItemsProgressAtom, (prev) => ({
      ...prev,
      [update.ratingKey]: update.progressPercent,
    }));
  },
);

/* ────────────────────────────────────────────────────────────
   Derived Atoms (Read-only)
   Computed values based on the main state
   ──────────────────────────────────────────────────────────── */

/**
 * Read-only atom for the current media item
 */
export const currentItemAtom = atom(
  (get) => get(mediaPlayerStateAtom).currentItem,
);

/**
 * Read-only atom for playing state
 */
export const isPlayingAtom = atom((get) => get(mediaPlayerStateAtom).isPlaying);

/**
 * Read-only atom for modal open state
 */
export const isModalOpenAtom = atom((get) => get(mediaPlayerStateAtom).isOpen);

/**
 * Read-only atom for progress percentage (0-100)
 */
export const progressPercentAtom = atom((get) => {
  const state = get(mediaPlayerStateAtom);
  return state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0;
});

/**
 * Read-only atom for buffered percentage (0-100)
 */
export const bufferedPercentAtom = atom((get) => {
  const state = get(mediaPlayerStateAtom);
  return state.duration > 0 ? (state.bufferedTime / state.duration) * 100 : 0;
});

/**
 * Read-only atom for formatted current time
 */
export const formattedCurrentTimeAtom = atom((get) => {
  const currentTime = get(mediaPlayerStateAtom).currentTime;
  return formatTime(currentTime);
});

/**
 * Read-only atom for formatted duration
 */
export const formattedDurationAtom = atom((get) => {
  const duration = get(mediaPlayerStateAtom).duration;
  return formatTime(duration);
});

/**
 * Read-only atom for loading/error state
 */
export const playerStatusAtom = atom((get) => {
  const state = get(mediaPlayerStateAtom);

  if (state.error) return { status: "error", message: state.error } as const;
  if (state.isLoading) return { status: "loading" } as const;
  if (state.isBuffering) return { status: "buffering" } as const;
  if (!state.canPlay) return { status: "waiting" } as const;

  return { status: "ready" } as const;
});

/* ────────────────────────────────────────────────────────────
   Utility Functions
   Helper functions used by atoms
   ──────────────────────────────────────────────────────────── */

/**
 * Format time in seconds to MM:SS or HH:MM:SS format
 */
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}
