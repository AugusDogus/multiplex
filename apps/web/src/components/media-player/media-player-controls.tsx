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
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMediaPlayerStore } from "~/stores/media-player-store";
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
}

export function MediaPlayerControls({
  isVisible,
  actions,
  progressOnly = false,
  className = "",
  onSettingsOpenChange,
  isWatchTogetherActive = false,
}: MediaPlayerControlsProps) {
  const currentTime = useMediaPlayerStore((state) => state.currentTime);
  const duration = useMediaPlayerStore((state) => state.duration);
  const isPlaying = useMediaPlayerStore((state) => state.isPlaying);
  const volume = useMediaPlayerStore((state) => state.volume);
  const isMuted = useMediaPlayerStore((state) => state.isMuted);
  const isFullscreen = useMediaPlayerStore((state) => state.isFullscreen);
  const canPlay = useMediaPlayerStore((state) => state.canPlay);

  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const volumeRef = useRef<HTMLDivElement>(null);
  /**
   * Calculate volume from mouse position
   */
  const getVolumeFromPosition = useCallback((clientX: number): number => {
    if (!volumeRef.current) return 0;

    const rect = volumeRef.current.getBoundingClientRect();
    const percentage = clamp((clientX - rect.left) / rect.width, 0, 1);
    return percentage;
  }, []);

  /**
   * Handle volume bar mouse down
   */
  const handleVolumeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDraggingVolume(true);

      const volume = getVolumeFromPosition(e.clientX);
      actions.setVolume(volume);
    },
    [getVolumeFromPosition, actions],
  );

  /**
   * Handle volume drag
   */
  const handleVolumeMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDraggingVolume) return;

      const volume = getVolumeFromPosition(e.clientX);
      actions.setVolume(volume);
    },
    [isDraggingVolume, getVolumeFromPosition, actions],
  );

  /**
   * Handle volume drag end
   */
  const handleVolumeMouseUp = useCallback(() => {
    setIsDraggingVolume(false);
  }, []);

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
  }, [isDraggingVolume, handleVolumeMouseMove, handleVolumeMouseUp]);

  if (!isVisible) return null;

  return (
    <div
      className={`relative w-full bg-linear-to-t from-black/90 via-black/60 to-transparent px-6 py-4 transition-all duration-300 ${className}`}
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
                variant="ghost"
                size="icon"
                onClick={actions.togglePlay}
                className="text-white hover:bg-white/20"
                disabled={!canPlay}
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
                    className="group h-full cursor-pointer rounded-full bg-white/20"
                    onMouseDown={handleVolumeMouseDown}
                  >
                    <div
                      className="h-full rounded-full bg-white transition-all duration-200"
                      style={{
                        width: `${isMuted ? 0 : volume * 100}%`,
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
