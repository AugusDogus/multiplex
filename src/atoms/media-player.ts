import { atom } from "jotai";
import type { MediaPlayerItem, MediaPlayerState, NextEpisodeInfo } from "~/types/media-player";

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

  // Auto-play next episode state
  autoPlay: {
    isEnabled: false,
    isCountingDown: false,
    countdownSeconds: 0,
    nextEpisode: null,
    countdownTimeout: null,
  },
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
  
  // Clear auto-play interval
  if (state.autoPlay.countdownTimeout) {
    clearInterval(state.autoPlay.countdownTimeout);
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
    // Reset auto-play state
    autoPlay: {
      isEnabled: false,
      isCountingDown: false,
      countdownSeconds: 0,
      nextEpisode: null,
      countdownTimeout: null,
    },
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

/**
 * Write-only atom to start auto-play countdown
 */
export const startAutoPlayCountdownAtom = atom(
  null,
  (get, set, params: NextEpisodeInfo | { nextEpisode: NextEpisodeInfo; countdownSeconds: number }) => {
    const state = get(mediaPlayerStateAtom);
    
    // Clear any existing countdown interval
    if (state.autoPlay.countdownTimeout) {
      clearInterval(state.autoPlay.countdownTimeout);
    }

    // Handle both old and new parameter formats
    const nextEpisode = 'nextEpisode' in params ? params.nextEpisode : params;
    const initialCountdownSeconds = 'countdownSeconds' in params ? params.countdownSeconds : 5;

    set(mediaPlayerStateAtom, (prev) => ({
      ...prev,
      autoPlay: {
        ...prev.autoPlay,
        isEnabled: true,
        isCountingDown: true,
        countdownSeconds: initialCountdownSeconds,
        nextEpisode,
        countdownTimeout: null,
      },
    }));

    // Start countdown
    let seconds = initialCountdownSeconds;
    const countdownInterval = setInterval(() => {
      seconds -= 1;
      
      if (seconds <= 0) {
        clearInterval(countdownInterval);
        // Trigger auto-play
        set(triggerAutoPlayAtom, nextEpisode);
      } else {
        set(mediaPlayerStateAtom, (prev) => ({
          ...prev,
          autoPlay: {
            ...prev.autoPlay,
            countdownSeconds: seconds,
          },
        }));
      }
    }, 1000);

    // Store the interval ID directly (cross-platform compatible)
    set(mediaPlayerStateAtom, (prev) => ({
      ...prev,
      autoPlay: {
        ...prev.autoPlay,
        countdownTimeout: countdownInterval as unknown as number,
      },
    }));
  },
);

/**
 * Write-only atom to cancel auto-play countdown
 */
export const cancelAutoPlayAtom = atom(null, (get, set) => {
  const state = get(mediaPlayerStateAtom);
  
  if (state.autoPlay.countdownTimeout) {
    clearInterval(state.autoPlay.countdownTimeout);
  }

  set(mediaPlayerStateAtom, (prev) => ({
    ...prev,
    autoPlay: {
      ...prev.autoPlay,
      isEnabled: false,
      isCountingDown: false,
      countdownSeconds: 0,
      nextEpisode: null,
      countdownTimeout: null,
    },
  }));
});

/**
 * Write-only atom to trigger auto-play of next episode
 */
export const triggerAutoPlayAtom = atom(
  null,
  (get, set, nextEpisode: NextEpisodeInfo) => {
    // Cancel countdown
    set(cancelAutoPlayAtom);
    
    // Create a MediaPlayerItem from the next episode info
    const currentItem = get(mediaPlayerStateAtom).currentItem;
    if (!currentItem) return;

    const nextEpisodeItem: MediaPlayerItem = {
      ...currentItem, // Copy server connection details
      ratingKey: nextEpisode.ratingKey,
      key: nextEpisode.key,
      title: nextEpisode.title,
      type: "episode",
      index: nextEpisode.index,
      parentIndex: nextEpisode.parentIndex,
      thumb: nextEpisode.thumb,
      art: nextEpisode.art,
      duration: nextEpisode.duration,
      grandparentTitle: nextEpisode.grandparentTitle,
      parentTitle: nextEpisode.parentTitle,
      viewOffset: 0, // Start from beginning
    };

    // Open the next episode
    set(openMediaPlayerAtom, nextEpisodeItem);
  },
);
