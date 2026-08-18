"use client";

import { useEffect, useEffectEvent } from "react";
import type { MediaPlayerActions } from "~/types/media-player";

/* ────────────────────────────────────────────────────────────
   Keyboard Shortcuts Hook
   Handles keyboard navigation and media controls
   ──────────────────────────────────────────────────────────── */

export type MediaShortcutTargetKind =
  | "input"
  | "textarea"
  | "editable"
  | "button"
  | "other";

export function getMediaShortcutTargetKind(
  target: EventTarget | null,
): MediaShortcutTargetKind {
  if (target instanceof HTMLInputElement) return "input";
  if (target instanceof HTMLTextAreaElement) return "textarea";
  if (target instanceof HTMLButtonElement) return "button";
  if (target instanceof HTMLElement && target.contentEditable === "true") {
    return "editable";
  }
  return "other";
}

export function shouldHandleMediaShortcutFor(event: {
  readonly code: string;
  readonly defaultPrevented: boolean;
  readonly targetKind: MediaShortcutTargetKind;
}): boolean {
  if (event.defaultPrevented) return false;

  switch (event.targetKind) {
    case "input":
    case "textarea":
    case "editable":
      return false;
    case "button":
      // Native buttons already fire click on Space.
      return event.code !== "Space";
    case "other":
      return true;
    default: {
      const _exhaustive: never = event.targetKind;
      return _exhaustive;
    }
  }
}

export function shouldHandleMediaShortcut(event: KeyboardEvent): boolean {
  return shouldHandleMediaShortcutFor({
    code: event.code,
    defaultPrevented: event.defaultPrevented,
    targetKind: getMediaShortcutTargetKind(event.target),
  });
}

interface UseKeyboardShortcutsProps {
  /**
   * Whether the media player modal is open
   */
  isOpen: boolean;
  /**
   * Media player actions
   */
  actions: MediaPlayerActions & {
    skipForward?: (seconds?: number) => void;
    skipBackward?: (seconds?: number) => void;
    jumpToStart?: () => void;
    jumpToEnd?: () => void;
  };
  /**
   * Current playback time in seconds
   */
  currentTime: number;
  /**
   * Total duration in seconds
   */
  duration: number;
  /**
   * Current volume level (0-1)
   */
  volume: number;
}

export function useKeyboardShortcuts({
  isOpen,
  actions,
  duration,
  volume,
}: UseKeyboardShortcutsProps) {
  const handleKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (!shouldHandleMediaShortcut(e)) return;

    // Prevent default behavior for media keys
    switch (e.code) {
      case "Space":
        e.preventDefault();
        actions.togglePlay();
        break;

      case "Escape":
        e.preventDefault();
        actions.closePlayer();
        break;

      case "ArrowLeft":
        e.preventDefault();
        if (e.shiftKey) {
          // Shift + Left Arrow: Skip backward 30 seconds
          actions.skipBackward?.(30);
        } else {
          // Left Arrow: Skip backward 10 seconds
          actions.skipBackward?.(10);
        }
        break;

      case "ArrowRight":
        e.preventDefault();
        if (e.shiftKey) {
          // Shift + Right Arrow: Skip forward 30 seconds
          actions.skipForward?.(30);
        } else {
          // Right Arrow: Skip forward 10 seconds
          actions.skipForward?.(10);
        }
        break;

      case "ArrowUp":
        e.preventDefault();
        // Volume up by 10%
        actions.setVolume(Math.min(1, volume + 0.1));
        break;

      case "ArrowDown":
        e.preventDefault();
        // Volume down by 10%
        actions.setVolume(Math.max(0, volume - 0.1));
        break;

      case "KeyM":
        e.preventDefault();
        actions.toggleMute();
        break;

      case "KeyF":
        e.preventDefault();
        actions.toggleFullscreen();
        break;

      case "Home":
        e.preventDefault();
        actions.jumpToStart?.();
        break;

      case "End":
        e.preventDefault();
        actions.jumpToEnd?.();
        break;

      case "Digit0":
      case "Numpad0":
        e.preventDefault();
        // Jump to beginning
        actions.seek(0);
        break;

      case "Digit1":
      case "Numpad1":
        e.preventDefault();
        // Jump to 10%
        actions.seek(duration * 0.1);
        break;

      case "Digit2":
      case "Numpad2":
        e.preventDefault();
        // Jump to 20%
        actions.seek(duration * 0.2);
        break;

      case "Digit3":
      case "Numpad3":
        e.preventDefault();
        // Jump to 30%
        actions.seek(duration * 0.3);
        break;

      case "Digit4":
      case "Numpad4":
        e.preventDefault();
        // Jump to 40%
        actions.seek(duration * 0.4);
        break;

      case "Digit5":
      case "Numpad5":
        e.preventDefault();
        // Jump to 50%
        actions.seek(duration * 0.5);
        break;

      case "Digit6":
      case "Numpad6":
        e.preventDefault();
        // Jump to 60%
        actions.seek(duration * 0.6);
        break;

      case "Digit7":
      case "Numpad7":
        e.preventDefault();
        // Jump to 70%
        actions.seek(duration * 0.7);
        break;

      case "Digit8":
      case "Numpad8":
        e.preventDefault();
        // Jump to 80%
        actions.seek(duration * 0.8);
        break;

      case "Digit9":
      case "Numpad9":
        e.preventDefault();
        // Jump to 90%
        actions.seek(duration * 0.9);
        break;

      case "KeyJ":
        e.preventDefault();
        // J: Skip backward 10 seconds (YouTube-style)
        actions.skipBackward?.(10);
        break;

      case "KeyK":
        e.preventDefault();
        // K: Toggle play/pause (YouTube-style)
        actions.togglePlay();
        break;

      case "KeyL":
        e.preventDefault();
        // L: Skip forward 10 seconds (YouTube-style)
        actions.skipForward?.(10);
        break;

      case "Comma":
        e.preventDefault();
        // Comma: Previous frame (when paused) or skip backward 1 second
        actions.skipBackward?.(1);
        break;

      case "Period":
        e.preventDefault();
        // Period: Next frame (when paused) or skip forward 1 second
        actions.skipForward?.(1);
        break;

      default:
        // Don't prevent default for unhandled keys
        break;
    }
  });

  useEffect(() => {
    // Only attach keyboard listeners when modal is open
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      handleKeyDown(event);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  // This hook doesn't return anything as it's purely for side effects
  return null;
}
