/* ────────────────────────────────────────────────────────────
   Media Player Barrel Exports
   Centralized exports for the media player components
   ──────────────────────────────────────────────────────────── */

// Main Components
export { MediaPlayerControls } from "./media-player-controls";
export { MediaPlayerModal } from "./media-player-modal";
export { FadeOverlay, MediaPlayerOverlay } from "./media-player-overlay";
export { MediaPlayerProgress } from "./media-player-progress";
export { MediaPlayerVideo } from "./media-player-video";

// Hooks
export {
  getKeyboardShortcuts,
  useKeyboardShortcuts,
} from "./hooks/use-keyboard-shortcuts";
export { useMediaPlayer } from "./hooks/use-media-player";
export { useTimelineUpdates } from "./hooks/use-timeline-updates";

// Utilities
export * from "./utils/media-player-utils";
export * from "./utils/plex-stream-utils";

// Types (re-export from main types file)
export type {
  MediaPlayerActions,
  MediaPlayerItem,
  MediaPlayerState,
} from "~/types/media-player";
