"use client";

import React, { useEffect, useEffectEvent, useRef, useState } from "react";
import { usePlayerStateSelector } from "~/lib/effect/player-atoms";
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
  currentTime,
  duration,
  onSeek,
  disabled = false,
  className = "",
}: MediaPlayerProgressProps) {
  const bufferedTime = usePlayerStateSelector((state) => state.bufferedTime);

  // Compute values locally to avoid object reference issues
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPercent = duration > 0 ? (bufferedTime / duration) * 100 : 0;
  const formattedCurrentTime = formatTime(currentTime);
  const formattedDuration = formatTime(duration);

  const [isDragging, setIsDragging] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  /**
   * Calculate time from mouse position
   */
  const getTimeFromPosition = (clientX: number): number => {
    if (!progressRef.current) return 0;

    const rect = progressRef.current.getBoundingClientRect();
    const percentage = clamp((clientX - rect.left) / rect.width, 0, 1);
    return percentage * duration;
  };

  /**
   * Handle mouse down on progress bar
   */
  const handleMouseDown = (e: React.MouseEvent) => {
    if (disabled || duration === 0) return;

    e.preventDefault();
    setIsDragging(true);

    const time = getTimeFromPosition(e.clientX);
    onSeek(time);
  };

  /**
   * Handle mouse move during drag
   */
  const handleMouseMove = useEffectEvent((e: MouseEvent) => {
    if (!isDragging || disabled || duration === 0) return;

    const time = getTimeFromPosition(e.clientX);
    onSeek(time);
  });

  /**
   * Handle mouse up to end drag
   */
  const handleMouseUp = useEffectEvent(() => {
    setIsDragging(false);
  });

  /**
   * Handle mouse move for hover preview
   */
  const handleProgressMouseMove = (e: React.MouseEvent) => {
    if (disabled || duration === 0) return;

    const time = getTimeFromPosition(e.clientX);
    setHoverTime(time);
  };

  /**
   * Handle mouse leave to clear hover
   */
  const handleProgressMouseLeave = () => {
    setHoverTime(null);
  };

  const handleProgressKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (disabled || duration === 0) return;

    let nextTime: number;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        nextTime = currentTime - 5;
        break;
      case "ArrowRight":
      case "ArrowUp":
        nextTime = currentTime + 5;
        break;
      case "Home":
        nextTime = 0;
        break;
      case "End":
        nextTime = duration;
        break;
      default:
        return;
    }

    event.preventDefault();
    onSeek(clamp(nextTime, 0, duration));
  };

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
  }, [isDragging]);

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
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label="Playback position"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={currentTime}
          aria-disabled={disabled}
          className={`group relative h-2 cursor-pointer rounded-full bg-white/20 ${disabled ? "cursor-not-allowed opacity-50" : "hover:h-3"} transition-[height] duration-200 ease-out`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleProgressMouseMove}
          onMouseLeave={handleProgressMouseLeave}
          onKeyDown={handleProgressKeyDown}
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
