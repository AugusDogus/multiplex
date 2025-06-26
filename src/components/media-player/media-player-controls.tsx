"use client";

import { useAtom } from "jotai";
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
import { mediaPlayerStateAtom } from "~/atoms/media-player";
import { Button } from "~/components/ui/button";
import { type useMediaPlayer } from "./hooks/use-media-player";
import { MediaPlayerProgress } from "./media-player-progress";
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
   * Additional CSS classes
   */
  className?: string;
}

export function MediaPlayerControls({
  isVisible,
  actions,
  className = "",
}: MediaPlayerControlsProps) {
  const [state] = useAtom(mediaPlayerStateAtom);
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
      className={`relative w-full bg-gradient-to-t from-black/90 via-black/60 to-transparent px-6 py-4 transition-all duration-300 ${className}`}
    >
      <div className="space-y-3">
        {/* Progress Bar */}
        <MediaPlayerProgress
          currentTime={state.currentTime}
          duration={state.duration}
          onSeek={actions.seek}
          disabled={!state.canPlay}
        />

        {/* Control Buttons Row */}
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
              disabled={!state.canPlay}
            >
              <SkipBack className="h-6 w-6" />
            </Button>

            {/* Play/Pause */}
            <Button
              variant="ghost"
              size="icon"
              onClick={actions.togglePlay}
              className="text-white hover:bg-white/20"
              disabled={!state.canPlay}
            >
              {state.isPlaying ? (
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
              disabled={!state.canPlay}
            >
              <SkipForward className="h-6 w-6" />
            </Button>
          </div>

          {/* Right Side - Volume and Fullscreen */}
          <div className="flex flex-1 items-center justify-end gap-4">
            {/* Volume Control */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={actions.toggleMute}
                className="text-white hover:bg-white/20"
              >
                {state.isMuted || state.volume === 0 ? (
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
                      width: `${state.isMuted ? 0 : state.volume * 100}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Fullscreen Toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={actions.toggleFullscreen}
              className="text-white hover:bg-white/20"
            >
              {state.isFullscreen ? (
                <Minimize className="h-5 w-5" />
              ) : (
                <Maximize className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
