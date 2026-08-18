"use client";

import {
  Maximize,
  Minimize,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import React, {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type RefObject,
} from "react";
import { usePlayerStateSelector } from "~/lib/effect/player-atoms";
import { usePlayerPrefsStore } from "~/stores/player-prefs-store";
import { shallow } from "zustand/shallow";
import { Button } from "~/components/ui/button";
import { type useMediaPlayer } from "./hooks/use-media-player";
import { MediaPlayerProgress } from "./media-player-progress";
import { MediaPlayerSettingsMenu } from "./media-player-settings-menu";
import { clamp } from "./utils/media-player-utils";

/* ────────────────────────────────────────────────────────────
   Media Player Controls
   Control bar with play/pause, volume, progress, and fullscreen
   ──────────────────────────────────────────────────────────── */

interface MediaPlayerControlsProps {
  /**
   * Whether the controls are visible
   */
  isVisible: boolean;
  /**
   * Media player actions
   */
  actions: ReturnType<typeof useMediaPlayer>["actions"];
  /**
   * When true, only the progress bar is shown (mobile uses center transport controls).
   */
  progressOnly?: boolean;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Notified when the settings popover open state changes.
   */
  onSettingsOpenChange?: (open: boolean) => void;
  /**
   * True while a Watch Together session is active; hides playback-speed
   * controls that can't be synced across viewers.
   */
  isWatchTogetherActive?: boolean;
  /**
   * Play/pause control used as the dialog's initial focus target.
   */
  playToggleRef?: RefObject<HTMLButtonElement | null>;
}

export function MediaPlayerControls({
  isVisible,
  actions,
  progressOnly = false,
  className = "",
  onSettingsOpenChange,
  isWatchTogetherActive = false,
  playToggleRef,
}: MediaPlayerControlsProps) {
  const { currentTime, duration, isPlaying, isFullscreen, canPlay } =
    usePlayerStateSelector(
      (state) => ({
        currentTime: state.currentTime,
        duration: state.duration,
        isPlaying: state.isPlaying,
        isFullscreen: state.isFullscreen,
        canPlay: state.canPlay,
      }),
      shallow,
    );
  const volume = usePlayerPrefsStore((state) => state.volume);
  const isMuted = usePlayerPrefsStore((state) => state.isMuted);

  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const volumeRef = useRef<HTMLDivElement>(null);
  /**
   * Calculate volume from mouse position
   */
  const getVolumeFromPosition = (clientX: number): number => {
    if (!volumeRef.current) return 0;

    const rect = volumeRef.current.getBoundingClientRect();
    const percentage = clamp((clientX - rect.left) / rect.width, 0, 1);
    return percentage;
  };

  /**
   * Handle volume bar mouse down
   */
  const handleVolumeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingVolume(true);

    const volume = getVolumeFromPosition(e.clientX);
    actions.setVolume(volume);
  };

  /**
   * Handle volume drag
   */
  const handleVolumeMouseMove = useEffectEvent((e: MouseEvent) => {
    if (!isDraggingVolume) return;

    const volume = getVolumeFromPosition(e.clientX);
    actions.setVolume(volume);
  });

  /**
   * Handle volume drag end
   */
  const handleVolumeMouseUp = useEffectEvent(() => {
    setIsDraggingVolume(false);
  });

  const handleVolumeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    actions.setVolume(clamp(volume + direction * 0.05, 0, 1));
  };

  // Attach global mouse events for volume dragging
  useEffect(() => {
    if (isDraggingVolume) {
      document.addEventListener("mousemove", handleVolumeMouseMove);
      document.addEventListener("mouseup", handleVolumeMouseUp);

      return () => {
        document.removeEventListener("mousemove", handleVolumeMouseMove);
        document.removeEventListener("mouseup", handleVolumeMouseUp);
      };
    }
  }, [isDraggingVolume]);

  if (!isVisible) return null;

  return (
    <div
      className={`relative w-full bg-linear-to-t from-black/90 via-black/60 to-transparent px-6 py-4 transition-opacity duration-300 ${className}`}
    >
      <div className="space-y-3">
        {/* Progress Bar */}
        <MediaPlayerProgress
          currentTime={currentTime}
          duration={duration}
          onSeek={actions.seek}
          disabled={!canPlay}
        />

        {/* Control Buttons Row — desktop only; mobile uses center transport controls */}
        {!progressOnly && (
          <div className="flex items-center justify-between pb-2">
            {/* Left Side - Empty for spacing */}
            <div className="flex-1"></div>

            {/* Center - Playback Controls */}
            <div className="flex items-center gap-3">
              {/* Skip Backward */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => actions.skipBackward?.(10)}
                className="text-white hover:bg-white/20"
                disabled={!canPlay}
              >
                <SkipBack className="h-6 w-6" />
              </Button>

              {/* Play/Pause */}
              <Button
                ref={playToggleRef}
                variant="ghost"
                size="icon"
                onClick={actions.togglePlay}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="text-white hover:bg-white/20"
              >
                {isPlaying ? (
                  <Pause className="h-6 w-6" />
                ) : (
                  <Play className="h-6 w-6" />
                )}
              </Button>

              {/* Skip Forward */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => actions.skipForward?.(10)}
                className="text-white hover:bg-white/20"
                disabled={!canPlay}
              >
                <SkipForward className="h-6 w-6" />
              </Button>
            </div>

            {/* Right Side - Volume and Fullscreen */}
            <div className="flex flex-1 items-center justify-end gap-4">
              {/* Volume Control */}
              <div className="hidden items-center gap-2 sm:flex">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={actions.toggleMute}
                  className="text-white hover:bg-white/20"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="h-5 w-5" />
                  ) : (
                    <Volume2 className="h-5 w-5" />
                  )}
                </Button>

                {/* Volume Slider */}
                <div className="relative h-2 w-20">
                  <div
                    ref={volumeRef}
                    role="slider"
                    tabIndex={0}
                    aria-label="Volume"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round((isMuted ? 0 : volume) * 100)}
                    className="group h-full cursor-pointer rounded-full bg-white/20"
                    onMouseDown={handleVolumeMouseDown}
                    onKeyDown={handleVolumeKeyDown}
                  >
                    <div
                      className="h-full origin-left rounded-full bg-white transition-transform duration-200"
                      style={{
                        transform: `scaleX(${isMuted ? 0 : volume})`,
                      }}
                    />
                  </div>
                </div>
              </div>

              <MediaPlayerSettingsMenu
                disabled={!canPlay}
                isWatchTogetherActive={isWatchTogetherActive}
                onOpenChange={onSettingsOpenChange}
              />

              {/* Fullscreen Toggle */}
              <Button
                variant="ghost"
                size="icon"
                onClick={actions.toggleFullscreen}
                className="text-white hover:bg-white/20"
              >
                {isFullscreen ? (
                  <Minimize className="h-5 w-5" />
                ) : (
                  <Maximize className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
