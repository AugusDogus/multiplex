"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SeekOverlayDirection = "backward" | "forward";

export interface SeekOverlayState {
  direction: SeekOverlayDirection;
  seconds: number;
  key: number;
}

const DEFAULT_SEEK_OVERLAY_MS = 2200;
const SEEK_SEQUENCE_WINDOW_MS = 1400;

export function useSeekOverlay(displayMs = DEFAULT_SEEK_OVERLAY_MS) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequenceRef = useRef<{
    direction: SeekOverlayDirection;
    seconds: number;
  } | null>(null);
  const overlayKeyRef = useRef(0);
  const [overlay, setOverlay] = useState<SeekOverlayState | null>(null);

  const clearOverlayTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const clearSequenceTimeout = useCallback(() => {
    if (sequenceTimeoutRef.current) {
      clearTimeout(sequenceTimeoutRef.current);
      sequenceTimeoutRef.current = null;
    }
  }, []);

  const resetSequence = useCallback(() => {
    clearSequenceTimeout();
    sequenceRef.current = null;
  }, [clearSequenceTimeout]);

  const resetSequenceDelayed = useCallback(() => {
    clearSequenceTimeout();
    sequenceTimeoutRef.current = setTimeout(() => {
      sequenceRef.current = null;
      sequenceTimeoutRef.current = null;
    }, SEEK_SEQUENCE_WINDOW_MS);
  }, [clearSequenceTimeout]);

  const showOverlay = useCallback(
    (direction: SeekOverlayDirection, seconds: number, accumulate = true) => {
      const previous = sequenceRef.current;
      const totalSeconds =
        accumulate && previous?.direction === direction
          ? previous.seconds + seconds
          : seconds;

      sequenceRef.current = { direction, seconds: totalSeconds };
      resetSequenceDelayed();

      overlayKeyRef.current += 1;
      setOverlay({
        direction,
        seconds: totalSeconds,
        key: overlayKeyRef.current,
      });
      clearOverlayTimeout();
      timeoutRef.current = setTimeout(() => {
        setOverlay(null);
        timeoutRef.current = null;
        resetSequence();
      }, displayMs);
    },
    [clearOverlayTimeout, displayMs, resetSequence, resetSequenceDelayed],
  );

  const hideOverlay = useCallback(() => {
    clearOverlayTimeout();
    resetSequence();
    setOverlay(null);
  }, [clearOverlayTimeout, resetSequence]);

  useEffect(() => {
    return () => {
      clearOverlayTimeout();
      clearSequenceTimeout();
    };
  }, [clearOverlayTimeout, clearSequenceTimeout]);

  return {
    overlay,
    showOverlay,
    hideOverlay,
    clearOverlayTimeout,
  };
}
