"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePlayerState } from "~/lib/effect/player-atoms";
import { clamp } from "./utils/media-player-utils";
import { formatTime } from "./utils/playback-time-utils";

/* ────────────────────────────────────────────────────────────
   Media Player Progress Bar
   Interactive progress bar with seek functionality
   ──────────────────────────────────────────────────────────── */

interface MediaPlayerProgressProps {
  /**
   * Current time in seconds
   */
  currentTime: number;
  /**
   * Total duration in seconds
   */
  duration: number;
  /**
   * Callback fired when user seeks to a new position
   */
  onSeek: (time: number) => void;
  /**
   * Whether the progress bar is disabled
   */
  disabled?: boolean;
  /**
   * Additional CSS classes
   */
  className?: string;
}

export function MediaPlayerProgress({
  currentTime: _currentTime,
  duration,
  onSeek,
  disabled = false,
  className = "",
}: MediaPlayerProgressProps) {
  const player = usePlayerState();
  const currentTimeFromStore = player.currentTime;
  const durationFromStore = player.duration;
  const bufferedTime = player.bufferedTime;

  // Compute values locally to avoid object reference issues
  const progressPercent =
    durationFromStore > 0
      ? (currentTimeFromStore / durationFromStore) * 100
      : 0;
  const bufferedPercent =
    durationFromStore > 0 ? (bufferedTime / durationFromStore) * 100 : 0;
  const formattedCurrentTime = formatTime(currentTimeFromStore);
  const formattedDuration = formatTime(durationFromStore);

  const [isDragging, setIsDragging] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  /**
   * Calculate time from mouse position
   */
  const getTimeFromPosition = useCallback(
    (clientX: number): number => {
      if (!progressRef.current) return 0;

      const rect = progressRef.current.getBoundingClientRect();
      const percentage = clamp((clientX - rect.left) / rect.width, 0, 1);
      return percentage * duration;
    },
    [duration],
  );

  /**
   * Handle mouse down on progress bar
   */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled || duration === 0) return;

      e.preventDefault();
      setIsDragging(true);

      const time = getTimeFromPosition(e.clientX);
      onSeek(time);
    },
    [disabled, duration, getTimeFromPosition, onSeek],
  );

  /**
   * Handle mouse move during drag
   */
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || disabled || duration === 0) return;

      const time = getTimeFromPosition(e.clientX);
      onSeek(time);
    },
    [isDragging, disabled, duration, getTimeFromPosition, onSeek],
  );

  /**
   * Handle mouse up to end drag
   */
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  /**
   * Handle mouse move for hover preview
   */
  const handleProgressMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (disabled || duration === 0) return;

      const time = getTimeFromPosition(e.clientX);
      setHoverTime(time);
    },
    [disabled, duration, getTimeFromPosition],
  );

  /**
   * Handle mouse leave to clear hover
   */
  const handleProgressMouseLeave = useCallback(() => {
    setHoverTime(null);
  }, []);

  // Attach global mouse events for dragging
  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);

      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const progressWidth = `${progressPercent}%`;
  const bufferedWidth = `${bufferedPercent}%`;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Current Time */}
      <div className="min-w-12 text-right font-mono text-sm text-white/90">
        {formattedCurrentTime}
      </div>

      {/* Progress Bar Container */}
      <div className="relative flex-1">
        <div
          ref={progressRef}
          className={`group relative h-2 cursor-pointer rounded-full bg-white/20 ${disabled ? "cursor-not-allowed opacity-50" : "hover:h-3"} transition-[height] duration-200 ease-out`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleProgressMouseMove}
          onMouseLeave={handleProgressMouseLeave}
        >
          {/* Buffered Progress */}
          <div
            className="absolute top-0 left-0 h-full rounded-full bg-white/30 transition-[width] duration-300 ease-out"
            style={{ width: bufferedWidth }}
          />

          {/* Current Progress */}
          <div
            className={`absolute top-0 left-0 h-full rounded-full bg-white ${isDragging ? "" : "transition-[width] duration-300 ease-out"}`}
            style={{ width: progressWidth }}
          />

          {/* Hover Time Tooltip */}
          {hoverTime !== null && !isDragging && (
            <div
              className="pointer-events-none absolute bottom-6 -translate-x-1/2 rounded bg-black/80 px-2 py-1 text-xs whitespace-nowrap text-white"
              style={{
                left: `${(hoverTime / duration) * 100}%`,
                transform: "translateX(-50%)",
              }}
            >
              {formatTime(hoverTime)}
            </div>
          )}
        </div>
      </div>

      {/* Duration */}
      <div className="min-w-12 font-mono text-sm text-white/90">
        {formattedDuration}
      </div>
    </div>
  );
}
