"use client";

import { useRef } from "react";

function suppressNativeLongPress(event: TouchEvent) {
  if (event.touches.length > 1) return;
  event.preventDefault();
}

/**
 * Ref callback that attaches a non-passive touchstart listener.
 * React's onTouchStart is passive, so preventDefault must be registered
 * natively to block the browser's long-press detector (and haptic).
 */
export function useSuppressNativeLongPress(enabled: boolean) {
  const elementRef = useRef<HTMLDivElement | null>(null);

  return (node: HTMLDivElement | null) => {
    if (elementRef.current) {
      elementRef.current.removeEventListener(
        "touchstart",
        suppressNativeLongPress,
      );
      elementRef.current = null;
    }

    if (node === null) return;

    elementRef.current = node;
    if (enabled) {
      node.addEventListener("touchstart", suppressNativeLongPress, {
        passive: false,
      });
    }
  };
}
