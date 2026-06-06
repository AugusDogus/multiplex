import type {
  ContinueWatchingItem,
  Marker,
  PlayQueueResponse,
} from "@multiplex/plex-query";

/* ────────────────────────────────────────────────────────────
   Media Player Types
   Type definitions for the modal-based media player
   ──────────────────────────────────────────────────────────── */

/**
 * Enhanced ContinueWatchingItem with server connection details
 * for media playback
 */
export type MediaPlayerItem = ContinueWatchingItem & {
  serverUrl: string;
  authToken: string;
};

export type PlaybackRate = 0.5 | 0.75 | 1 | 1.25 | 1.5 | 1.75 | 2;
export type CaptionSize = "small" | "medium" | "large" | "extra-large";

/**
 * Next episode information for auto-play
 */
export interface NextEpisodeInfo {
  ratingKey: string;
  key: string;
  title: string;
  index: number;
  parentIndex: number;
  thumb?: string;
  art?: string;
  duration?: number;
  summary?: string;
  grandparentTitle?: string;
  parentTitle?: string;
}

/**
 * Complete state interface for the media player
 */
export interface MediaPlayerState {
  // Modal state
  isOpen: boolean;
  currentItem: MediaPlayerItem | null;

  // Play queue state
  playQueue: PlayQueueResponse | null;
  playQueueId: string | null;
  markers: Marker[];

  // Playback state
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  bufferedTime: number;
  playbackRate: PlaybackRate;
  /**
   * Seconds of the original timeline that map to `video.currentTime = 0` for
   * the currently loaded stream. Only non-zero for Plex transcoded streams,
   * which we restart at an offset because the transcoder advertises an empty
   * seekable range.
   */
  streamOffset: number;

  // Audio state
  volume: number;
  isMuted: boolean;

  // UI state
  isFullscreen: boolean;
  showControls: boolean;
  controlsTimeout: number | null;
  captionSize: CaptionSize;

  // Loading/Error state
  isLoading: boolean;
  error: string | null;

  // Video element state
  canPlay: boolean;
  isBuffering: boolean;

  // Auto-play next episode state
  autoPlay: {
    isEnabled: boolean;
    isCountingDown: boolean;
    countdownSeconds: number;
    nextEpisode: NextEpisodeInfo | null;
  };
}

/**
 * Action interface for media player controls
 */
export interface MediaPlayerActions {
  // Playback controls
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (time: number) => void;

  // Audio controls
  setVolume: (volume: number) => void;
  toggleMute: () => void;

  // UI controls
  toggleFullscreen: () => void;
  showControlsTemporarily: () => void;

  // Modal controls
  openPlayer: (item: MediaPlayerItem) => void;
  closePlayer: () => void;

  // Extended playback controls (optional)
  skipForward?: (seconds?: number) => void;
  skipBackward?: (seconds?: number) => void;
  jumpToStart?: () => void;
  jumpToEnd?: () => void;
}

/**
 * Type guard to check if an item has the required fields for media playback
 */
export function isMediaPlayerItem(
  item: ContinueWatchingItem & { serverUrl?: string; authToken?: string },
): item is MediaPlayerItem {
  return Boolean(item.serverUrl && item.authToken);
}

/**
 * Type guard to check if playback state is ready
 */
export function isPlaybackReady(state: MediaPlayerState): boolean {
  return Boolean(
    state.currentItem && state.canPlay && !state.isLoading && !state.error,
  );
}
