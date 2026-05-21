"use client";

import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/* ────────────────────────────────────────────────────────────
   Mobile video chrome gestures
   Tap to show/hide controls; double-tap left/right to seek.
   ──────────────────────────────────────────────────────────── */

export type MobileSeekZone = "backward" | "forward";

const DOUBLE_TAP_WINDOW_MS = 300;
const AUTO_HIDE_MS = 3000;

interface UseMobileVideoChromeOptions {
  showControls: boolean;
  showControlsImmediate: () => void;
  hideControlsImmediate: () => void;
  hideControlsDelayed: (delay?: number) => void;
  onDoubleTapSeek: (zone: MobileSeekZone) => void;
}

interface PendingTap {
  zone: MobileSeekZone;
  at: number;
}

function getSeekZone(clientY: number, rect: DOMRect): MobileSeekZone {
  return clientY < rect.top + rect.height / 2 ? "backward" : "forward";
}

export function useMobileVideoChrome({
  showControls,
  showControlsImmediate,
  hideControlsImmediate,
  hideControlsDelayed,
  onDoubleTapSeek,
}: UseMobileVideoChromeOptions) {
  const lastTapRef = useRef<PendingTap | null>(null);
  /** After a double-tap seek, suppress showing chrome until this time. */
  const suppressShowUntilRef = useRef(0);

  const extendAutoHide = useCallback(() => {
    hideControlsDelayed(AUTO_HIDE_MS);
  }, [hideControlsDelayed]);

  const handleSurfaceTap = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const zone = getSeekZone(event.clientY, rect);
      const now = Date.now();
      const lastTap = lastTapRef.current;

      // Second tap within window → seek; hide chrome (seek intent, not pause UI).
      if (lastTap?.zone === zone && now - lastTap.at < DOUBLE_TAP_WINDOW_MS) {
        lastTapRef.current = null;
        onDoubleTapSeek(zone);
        hideControlsImmediate();
        suppressShowUntilRef.current = now + DOUBLE_TAP_WINDOW_MS;
        return;
      }

      lastTapRef.current = { zone, at: now };

      if (showControls) {
        hideControlsImmediate();
        return;
      }

      // Between seeks in a rapid double-tap chain — don't flash the pause UI.
      if (now < suppressShowUntilRef.current) return;

      showControlsImmediate();
      extendAutoHide();
    },
    [
      extendAutoHide,
      hideControlsImmediate,
      onDoubleTapSeek,
      showControls,
      showControlsImmediate,
    ],
  );

  const resetAutoHide = useCallback(() => {
    if (!showControls) return;
    extendAutoHide();
  }, [extendAutoHide, showControls]);

  return {
    handleSurfaceTap,
    resetAutoHide,
  };
}
