"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/* ────────────────────────────────────────────────────────────
   useDragToDismiss
   YouTube/Twitter-style swipe-to-dismiss for the media player.
   The finger tracks the player 1:1 in the visual-down direction
   while dragging, with rubber-band resistance when going up,
   snap-back below threshold, and velocity-aware dismiss.

   On mobile, the player content is rendered into a container
   that is CSS-rotated 90° clockwise so a portrait phone shows
   landscape video. The user's "drag down" intent therefore
   maps to a physical-left finger swipe, and the player must
   translate physically left to follow the finger. We surface
   that via the `rotation` option.
   ──────────────────────────────────────────────────────────── */

// Pixels of net movement in the visual-down direction before we "claim"
// the gesture as a drag-to-dismiss. Below this, taps and the existing
// hold-to-fast-forward gesture inside the video surface are left alone.
const CLAIM_THRESHOLD_PX = 12;

// Distance (in viewport px along the visual-down axis) at which we commit
// to dismissing on release.
const DISMISS_DISTANCE_PX = 160;

// Flick velocity (px/ms in the visual-down direction) that triggers
// dismiss even if the user hasn't covered the full distance.
const DISMISS_VELOCITY_PX_PER_MS = 0.6;
const DISMISS_VELOCITY_MIN_DISTANCE_PX = 40;

const SETTLE_MS = 280;
const SETTLE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
const RUBBER_BAND_FACTOR = 6;
const MAX_SCALE_REDUCTION = 0.04;
const MAX_OPACITY_REDUCTION = 0.25;

/**
 * Visual rotation of the *content* the user sees, in degrees.
 * - 0: content is upright. Visual down = physical down (drag finger down).
 * - 90: content is rotated 90° clockwise (CSS `rotate(90deg)`). Visual down
 *   = physical left.
 * - -90: content is rotated 90° counter-clockwise. Visual down = physical right.
 *
 * The hook applies `transform: translate3d(...)` to a non-rotated wrapper,
 * so the resulting motion is in the device's physical coordinate frame.
 */
type ContentRotation = 0 | 90 | -90;

interface UseDragToDismissOptions {
  enabled: boolean;
  onDismiss: () => void;
  rotation?: ContentRotation;
}

export interface DragToDismissHandle {
  ref: (node: HTMLDivElement | null) => void;
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
  isDragging: boolean;
}

interface DragState {
  pointerId: number | null;
  startX: number;
  startY: number;
  startT: number;
  lastDown: number;
  lastT: number;
  claimed: boolean;
  dismissing: boolean;
}

/** Component-frame delta from raw physical pointer deltas. */
function toContentDelta(
  dxPhysical: number,
  dyPhysical: number,
  rotation: ContentRotation,
) {
  switch (rotation) {
    case 0:
      return { down: dyPhysical, cross: dxPhysical };
    // CSS rotate(90deg) maps content +Y to physical -X. Inverse: physical
    // motion projected onto content axes.
    case 90:
      return { down: -dxPhysical, cross: dyPhysical };
    case -90:
      return { down: dxPhysical, cross: dyPhysical };
    default: {
      const exhaustive: never = rotation;
      throw new Error(`Unhandled rotation: ${String(exhaustive)}`);
    }
  }
}

/** Translate vector in physical px corresponding to a visual-down offset. */
function toPhysicalOffset(visualDown: number, rotation: ContentRotation) {
  switch (rotation) {
    case 0:
      return { x: 0, y: visualDown };
    case 90:
      return { x: -visualDown, y: 0 };
    case -90:
      return { x: visualDown, y: 0 };
    default: {
      const exhaustive: never = rotation;
      throw new Error(`Unhandled rotation: ${String(exhaustive)}`);
    }
  }
}

/** Distance to push the player off-screen for dismiss animation. */
function offscreenDistance(rotation: ContentRotation): number {
  switch (rotation) {
    case 0:
      return window.innerHeight;
    case 90:
    case -90:
      return window.innerWidth;
    default: {
      const exhaustive: never = rotation;
      throw new Error(`Unhandled rotation: ${String(exhaustive)}`);
    }
  }
}

export function useDragToDismiss({
  enabled,
  onDismiss,
  rotation = 0,
}: UseDragToDismissOptions): DragToDismissHandle {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const stateRef = useRef<DragState>({
    pointerId: null,
    startX: 0,
    startY: 0,
    startT: 0,
    lastDown: 0,
    lastT: 0,
    claimed: false,
    dismissing: false,
  });
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setTransition = (value: string) => {
    const el = elementRef.current;
    if (!el) return;
    el.style.transition = value;
  };

  const writeTransform = (visualDown: number) => {
    const el = elementRef.current;
    if (!el) return;

    // Rubber-band on upward drag; 1:1 tracking on downward drag.
    const followed =
      visualDown < 0
        ? -Math.sqrt(-visualDown) * RUBBER_BAND_FACTOR
        : visualDown;
    const progress = Math.max(0, Math.min(1, visualDown / DISMISS_DISTANCE_PX));
    const scale = 1 - progress * MAX_SCALE_REDUCTION;
    const opacity = 1 - progress * MAX_OPACITY_REDUCTION;

    const { x, y } = toPhysicalOffset(followed, rotation);
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    el.style.opacity = String(opacity);
  };

  const clearTransform = () => {
    const el = elementRef.current;
    if (!el) return;
    el.style.transform = "";
    el.style.opacity = "";
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled) return;
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    if (stateRef.current.pointerId !== null) return;
    if (stateRef.current.dismissing) return;

    stateRef.current.pointerId = event.pointerId;
    stateRef.current.startX = event.clientX;
    stateRef.current.startY = event.clientY;
    stateRef.current.startT = event.timeStamp;
    stateRef.current.lastDown = 0;
    stateRef.current.lastT = event.timeStamp;
    stateRef.current.claimed = false;

    setTransition("none");
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const state = stateRef.current;
    if (state.pointerId !== event.pointerId) return;

    const dxPhysical = event.clientX - state.startX;
    const dyPhysical = event.clientY - state.startY;
    const { down, cross } = toContentDelta(dxPhysical, dyPhysical, rotation);

    state.lastDown = down;
    state.lastT = event.timeStamp;

    if (!state.claimed) {
      // Claim only on visual-down movement that dominates the orthogonal
      // axis. This lets quick taps, holds, and orthogonal swipes through.
      if (down > CLAIM_THRESHOLD_PX && Math.abs(down) > Math.abs(cross) * 1.2) {
        state.claimed = true;
        setIsDragging(true);
      } else {
        return;
      }
    }

    writeTransform(down);
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const state = stateRef.current;
    if (state.pointerId !== event.pointerId) return;

    const wasClaimed = state.claimed;
    const down = state.lastDown;
    const dt = Math.max(1, state.lastT - state.startT);
    const velocity = down / dt;

    state.pointerId = null;
    state.claimed = false;

    if (!wasClaimed) return;

    setIsDragging(false);
    setTransition(
      `transform ${SETTLE_MS}ms ${SETTLE_EASING}, opacity ${SETTLE_MS}ms ${SETTLE_EASING}`,
    );

    const shouldDismiss =
      down > DISMISS_DISTANCE_PX ||
      (velocity > DISMISS_VELOCITY_PX_PER_MS &&
        down > DISMISS_VELOCITY_MIN_DISTANCE_PX);

    if (shouldDismiss) {
      const el = elementRef.current;
      if (el) {
        const distance = offscreenDistance(rotation);
        const { x, y } = toPhysicalOffset(distance, rotation);
        el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${
          1 - MAX_SCALE_REDUCTION
        })`;
        el.style.opacity = "0";
      }
      state.dismissing = true;
      dismissTimeoutRef.current = setTimeout(() => {
        dismissTimeoutRef.current = null;
        onDismiss();
      }, SETTLE_MS);
    } else {
      clearTransform();
    }
  };

  useEffect(() => {
    return () => {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current);
        dismissTimeoutRef.current = null;
      }
    };
  }, []);

  const refCallback = (node: HTMLDivElement | null) => {
    elementRef.current = node;
  };

  return {
    ref: refCallback,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
    },
    isDragging: enabled && isDragging,
  };
}
