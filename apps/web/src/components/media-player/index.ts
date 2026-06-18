/* ────────────────────────────────────────────────────────────
   Media Player Barrel Exports
   Centralized exports for the media player components
   ──────────────────────────────────────────────────────────── */

// Main Components
export { MediaPlayerControls } from "./media-player-controls";
export { MediaPlayerModal } from "./media-player-modal";
export { FadeOverlay, MediaPlayerOverlay } from "./media-player-overlay";
export { MediaPlayerProgress } from "./media-player-progress";
export { MediaPlayerSkipOverlay } from "./media-player-skip-overlay";
export { MediaPlayerVideo } from "./media-player-video";

// Hooks
export {
  getKeyboardShortcuts,
  useKeyboardShortcuts,
} from "./hooks/use-keyboard-shortcuts";
export { useMediaPlayer } from "./hooks/use-media-player";
export { usePlayQueue } from "./hooks/use-play-queue";
export { useTimelineUpdates } from "./hooks/use-timeline-updates";

// Types (re-export from main types file)
export type {
  MediaPlayerActions,
  MediaPlayerItem,
  MediaPlayerState,
} from "~/types/media-player";
