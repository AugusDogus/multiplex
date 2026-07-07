"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

/* ────────────────────────────────────────────────────────────
   useVideoPressGesture
   Press-and-hold state machine for the video surface. Classifies
   each pointer interaction as one of:

   - tap   → fires onTap (mobile) or onClick (desktop)
   - hold  → temporarily multiplies the video's playbackRate
   - drag  → cancels the pending hold and suppresses the trailing
             tap/click (so a parent gesture like drag-to-dismiss
             doesn't accidentally toggle controls or trigger 2x).
   ──────────────────────────────────────────────────────────── */

interface UseVideoPressGestureOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Multiplier applied to the video's playbackRate while holding. */
  holdRate: number;
  /**
   * Whether press-and-hold fast forward is active. When false (e.g. during a
   * Watch Together session, where an independent local rate would desync
   * viewers) a press is only ever a tap/click — the rate is never changed.
   * Defaults to true.
   */
  holdEnabled?: boolean;
  /** Press duration (ms) that promotes a press to a hold. */
  holdActivationMs: number;
  /** Pointer movement (px) that promotes a press to a drag. */
  dragTolerancePx: number;
  /** Mobile tap callback (fires from pointerup, not click). */
  onTap?: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Desktop click callback. Suppressed after a hold or drag. */
  onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
}

interface PointerHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => void;
  onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
}

interface UseVideoPressGestureResult {
  pointerHandlers: PointerHandlers;
  /** Click handler that swallows clicks fired right after a hold or drag. */
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  /** True while the press has elevated the video's playback rate. */
  isHolding: boolean;
}

export function useVideoPressGesture({
  videoRef,
  holdRate,
  holdEnabled = true,
  holdActivationMs,
  dragTolerancePx,
  onTap,
  onClick,
}: UseVideoPressGestureOptions): UseVideoPressGestureResult {
  const [isHolding, setIsHolding] = useState(false);

  const previousRateRef = useRef<number | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);
  const holdAppliedRef = useRef(false);
  const activationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const suppressClickRef = useRef(false);

  const clearActivation = useCallback(() => {
    if (activationTimeoutRef.current) {
      clearTimeout(activationTimeoutRef.current);
      activationTimeoutRef.current = null;
    }
  }, []);

  const release = useCallback(
    (pointerId: number) => {
      if (pointerIdRef.current !== pointerId) return;

      const video = videoRef.current;
      if (video && previousRateRef.current !== null && holdAppliedRef.current) {
        video.playbackRate = previousRateRef.current;
      }

      previousRateRef.current = null;
      pointerIdRef.current = null;
      startPosRef.current = null;
      draggedRef.current = false;
      holdAppliedRef.current = false;
      clearActivation();
      setIsHolding(false);
    },
    [clearActivation, videoRef],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (pointerIdRef.current !== null) return;

      const video = videoRef.current;
      if (!video) return;

      const pointerId = event.pointerId;
      previousRateRef.current = video.playbackRate;
      pointerIdRef.current = pointerId;
      startPosRef.current = { x: event.clientX, y: event.clientY };
      draggedRef.current = false;
      holdAppliedRef.current = false;
      event.currentTarget.setPointerCapture(pointerId);

      // When hold-to-fast-forward is disabled, a press is only ever a tap/click;
      // never schedule the rate change.
      if (!holdEnabled) return;

      // Defer the playback rate change until the press qualifies as a hold,
      // so quick taps don't briefly jitter playback rate.
      clearActivation();
      activationTimeoutRef.current = setTimeout(() => {
        activationTimeoutRef.current = null;
        if (pointerIdRef.current !== pointerId) return;

        const activeVideo = videoRef.current;
        if (!activeVideo) return;

        activeVideo.playbackRate = holdRate;
        holdAppliedRef.current = true;
        setIsHolding(true);
      }, holdActivationMs);
    },
    [clearActivation, holdActivationMs, holdEnabled, holdRate, videoRef],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (pointerIdRef.current !== event.pointerId) return;
      if (draggedRef.current) return;

      const start = startPosRef.current;
      if (!start) return;

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.hypot(dx, dy) < dragTolerancePx) return;

      draggedRef.current = true;
      clearActivation();
    },
    [clearActivation, dragTolerancePx],
  );

  const handlePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (pointerIdRef.current !== event.pointerId) return;

      const wasHold = holdAppliedRef.current;
      const wasDrag = draggedRef.current;

      if (wasHold || wasDrag) {
        suppressClickRef.current = true;
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      release(event.pointerId);

      if (!wasHold && !wasDrag && onTap) {
        onTap(event);
      }
    },
    [onTap, release],
  );

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      onClick?.(event);
    },
    [onClick],
  );

  // Defensive cleanup: if the consumer unmounts mid-press, the pending hold
  // timer would otherwise fire afterward, touch a stale `videoRef`, and call
  // `setIsHolding` on an unmounted hook.
  useEffect(() => {
    return () => {
      if (activationTimeoutRef.current) {
        clearTimeout(activationTimeoutRef.current);
        activationTimeoutRef.current = null;
      }
    };
  }, []);

  return {
    pointerHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerEnd,
      onPointerCancel: handlePointerEnd,
      onPointerLeave: handlePointerEnd,
      onLostPointerCapture: handlePointerEnd,
    },
    onClick: handleClick,
    isHolding,
  };
}
