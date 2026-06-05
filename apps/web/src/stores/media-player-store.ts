import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { decideStreamMode } from "~/components/media-player/utils/plex-stream-utils";
import type {
  MediaPlayerItem,
  MediaPlayerState,
  NextEpisodeInfo,
  PlaybackRate,
} from "~/types/media-player";
import { useProgressStore } from "./progress-store";

interface MediaPlayerStore extends MediaPlayerState {
  // Actions
  openPlayer: (item: MediaPlayerItem) => void;
  closePlayer: () => void;
  updatePlaybackState: (updates: Partial<MediaPlayerState>) => void;

  // Timeline actions
  updateCurrentTime: (time: number) => void;
  updateDuration: (duration: number) => void;
  updateBufferedTime: (bufferedTime: number) => void;
  setPlaybackRate: (playbackRate: PlaybackRate) => void;
  setSelectedSubtitleStreamId: (streamId: number | null) => void;

  // Audio actions
  setVolume: (volume: number) => void;
  toggleMute: () => void;

  // UI actions
  toggleFullscreen: () => void;
  showControlsTemporarily: () => void;
  hideControls: () => void;

  // Auto-play actions
  startAutoPlayCountdown: (nextEpisode: NextEpisodeInfo) => void;
  setAutoPlayEnabled: (isEnabled: boolean) => void;
  cancelAutoPlay: () => void;
  triggerAutoPlay: (nextEpisode: NextEpisodeInfo) => void;
  updateCountdownSeconds: (seconds: number) => void;

  // Computed getters (no useEffect needed)
  getProgressPercent: () => number;
  getBufferedPercent: () => number;
  getFormattedCurrentTime: () => string;
  getFormattedDuration: () => string;
  getPlayerStatus: () => {
    status: "loading" | "ready" | "error" | "buffering" | "waiting";
    message?: string;
  };
  getIsReady: () => boolean;
}

export const useMediaPlayerStore = create<MediaPlayerStore>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state (mirror existing mediaPlayerStateAtom)
        isOpen: false,
        currentItem: null,
        playQueue: null,
        playQueueId: null,
        markers: [],
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        bufferedTime: 0,
        playbackRate: 1,
        selectedSubtitleStreamId: null,
        streamOffset: 0,
        volume: 1,
        isMuted: false,
        isFullscreen: false,
        showControls: true,
        controlsTimeout: null,
        isLoading: false,
        error: null,
        canPlay: false,
        isBuffering: false,
        autoPlay: {
          isEnabled: true,
          isCountingDown: false,
          countdownSeconds: 0,
          nextEpisode: null,
        },

        // Actions implementation
        openPlayer: (item) => {
          // Check if we have updated progress for this item from the current session
          const progressStore = useProgressStore.getState();
          const updatedProgressPercent = progressStore.getItemProgress(
            item.ratingKey,
          );

          // Calculate initial currentTime using updated progress if available
          const initialCurrentTime =
            updatedProgressPercent !== undefined && item.duration
              ? (updatedProgressPercent / 100) * (item.duration / 1000)
              : Math.floor(item.viewOffset ?? 0) / 1000;

          // Plex's transcoded MP4 stream can't be seeked after load, so for
          // resumed transcoded items we bake the resume position into the
          // initial stream URL via `offset`.
          const initialStreamOffset =
            initialCurrentTime > 0 && decideStreamMode(item) === "direct-stream"
              ? initialCurrentTime
              : 0;

          set({
            isOpen: true,
            currentItem: item,
            currentTime: initialCurrentTime,
            streamOffset: initialStreamOffset,
            isLoading: true,
            error: null,
            isPlaying: false,
            duration: 0,
            bufferedTime: 0,
            selectedSubtitleStreamId: null,
            canPlay: false,
            isBuffering: false,
          });
        },

        closePlayer: () => {
          const state = get();
          if (state.controlsTimeout) {
            clearTimeout(state.controlsTimeout);
          }

          set({
            isOpen: false,
            currentItem: null,
            playQueue: null,
            playQueueId: null,
            markers: [],
            isPlaying: false,
            currentTime: 0,
            duration: 0,
            bufferedTime: 0,
            selectedSubtitleStreamId: null,
            streamOffset: 0,
            isLoading: false,
            error: null,
            canPlay: false,
            isBuffering: false,
            controlsTimeout: null,
            autoPlay: {
              isEnabled: state.autoPlay.isEnabled,
              isCountingDown: false,
              countdownSeconds: 0,
              nextEpisode: null,
            },
            showControls: true,
            isFullscreen: false,
          });
        },

        updatePlaybackState: (updates) => set(updates),

        updateCurrentTime: (time) => set({ currentTime: time }),
        updateDuration: (duration) => set({ duration }),
        updateBufferedTime: (bufferedTime) => set({ bufferedTime }),
        setPlaybackRate: (playbackRate) => set({ playbackRate }),
        setSelectedSubtitleStreamId: (streamId) =>
          set({ selectedSubtitleStreamId: streamId }),

        setVolume: (volume) => set({ volume }),
        toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),

        toggleFullscreen: () =>
          set((state) => ({ isFullscreen: !state.isFullscreen })),

        showControlsTemporarily: () => {
          const state = get();
          if (state.controlsTimeout) {
            clearTimeout(state.controlsTimeout);
          }

          const timeout = window.setTimeout(() => {
            set({ showControls: false, controlsTimeout: null });
          }, 3000);

          set({ showControls: true, controlsTimeout: timeout });
        },

        hideControls: () => {
          const state = get();
          if (state.controlsTimeout) {
            clearTimeout(state.controlsTimeout);
          }
          set({ showControls: false, controlsTimeout: null });
        },

        startAutoPlayCountdown: (nextEpisode) => {
          set((state) => ({
            autoPlay: {
              ...state.autoPlay,
              isCountingDown: true,
              countdownSeconds: 5,
              nextEpisode,
            },
          }));
        },

        setAutoPlayEnabled: (isEnabled) => {
          set((state) => ({
            autoPlay: {
              ...state.autoPlay,
              isEnabled,
              isCountingDown: isEnabled ? state.autoPlay.isCountingDown : false,
              countdownSeconds: isEnabled ? state.autoPlay.countdownSeconds : 0,
              nextEpisode: isEnabled ? state.autoPlay.nextEpisode : null,
            },
          }));
        },

        cancelAutoPlay: () => {
          set((state) => ({
            autoPlay: {
              ...state.autoPlay,
              isCountingDown: false,
              countdownSeconds: 0,
              nextEpisode: null,
            },
          }));
        },

        triggerAutoPlay: (nextEpisode) => {
          const currentItem = get().currentItem;
          if (!currentItem) return;

          // Cancel countdown first
          get().cancelAutoPlay();

          // Create a MediaPlayerItem from the next episode info
          const nextEpisodeItem: MediaPlayerItem = {
            ...currentItem,
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
            viewOffset: 0,
          };

          // Open the next episode
          get().openPlayer(nextEpisodeItem);
        },

        updateCountdownSeconds: (timeRemaining) => {
          const state = get();

          if (!state.autoPlay.isCountingDown) {
            return;
          }

          const countdownSeconds = Math.max(Math.ceil(timeRemaining), 0);

          set((prevState) => ({
            autoPlay: {
              ...prevState.autoPlay,
              countdownSeconds,
            },
          }));

          // Trigger auto-play when countdown reaches 0
          if (countdownSeconds <= 0 && state.autoPlay.nextEpisode) {
            get().triggerAutoPlay(state.autoPlay.nextEpisode);
          }
        },

        // Computed getters
        getProgressPercent: () => {
          const { currentTime, duration } = get();
          return duration > 0 ? (currentTime / duration) * 100 : 0;
        },

        getBufferedPercent: () => {
          const { bufferedTime, duration } = get();
          return duration > 0 ? (bufferedTime / duration) * 100 : 0;
        },

        getFormattedCurrentTime: () => {
          const { currentTime } = get();
          return formatTime(currentTime);
        },

        getFormattedDuration: () => {
          const { duration } = get();
          return formatTime(duration);
        },

        getPlayerStatus: () => {
          const { error, isLoading, isBuffering, canPlay } = get();

          if (error) return { status: "error", message: error } as const;
          if (isLoading) return { status: "loading" } as const;
          if (isBuffering) return { status: "buffering" } as const;
          if (!canPlay) return { status: "waiting" } as const;

          return { status: "ready" } as const;
        },

        getIsReady: () => {
          const { currentItem, canPlay, isLoading, error } = get();
          return Boolean(currentItem && canPlay && !isLoading && !error);
        },
      }),
      {
        name: "media-player-storage",
        partialize: (state) => ({
          volume: state.volume,
          isMuted: state.isMuted,
          playbackRate: state.playbackRate,
          autoPlay: {
            isEnabled: state.autoPlay.isEnabled,
            isCountingDown: false,
            countdownSeconds: 0,
            nextEpisode: null,
          },
        }),
      },
    ),
    {
      name: "media-player-store",
    },
  ),
);

// Utility function (moved from atoms)
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}
