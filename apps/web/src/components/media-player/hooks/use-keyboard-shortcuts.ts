"use client";

import { useHotkeys } from "@tanstack/react-hotkeys";
import type { MediaPlayerActions } from "~/types/media-player";

/* ────────────────────────────────────────────────────────────
   Keyboard Shortcuts Hook
   Handles keyboard navigation and media controls
   ──────────────────────────────────────────────────────────── */

const SEEK_PERCENT_HOTKEYS = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
] as const;

export function shouldHandleMediaShortcut(event: {
  readonly code: string;
  readonly defaultPrevented: boolean;
  readonly isNativeButton: boolean;
}): boolean {
  if (event.defaultPrevented) return false;
  return !(event.code === "Space" && event.isNativeButton);
}

function onMediaHotkey(run: (event: KeyboardEvent) => void) {
  return (event: KeyboardEvent) => {
    if (
      !shouldHandleMediaShortcut({
        code: event.code,
        defaultPrevented: event.defaultPrevented,
        isNativeButton: event.target instanceof HTMLButtonElement,
      })
    ) {
      return;
    }
    event.preventDefault();
    run(event);
  };
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
  useHotkeys(
    [
      {
        hotkey: "Space",
        callback: onMediaHotkey(() => actions.togglePlay()),
      },
      { hotkey: "K", callback: onMediaHotkey(() => actions.togglePlay()) },
      {
        hotkey: "Escape",
        callback: onMediaHotkey(() => actions.closePlayer()),
      },
      {
        hotkey: "ArrowLeft",
        callback: onMediaHotkey(() => actions.skipBackward?.(10)),
      },
      {
        hotkey: "Shift+ArrowLeft",
        callback: onMediaHotkey(() => actions.skipBackward?.(30)),
      },
      {
        hotkey: "ArrowRight",
        callback: onMediaHotkey(() => actions.skipForward?.(10)),
      },
      {
        hotkey: "Shift+ArrowRight",
        callback: onMediaHotkey(() => actions.skipForward?.(30)),
      },
      {
        hotkey: "ArrowUp",
        callback: onMediaHotkey(() =>
          actions.setVolume(Math.min(1, volume + 0.1)),
        ),
      },
      {
        hotkey: "ArrowDown",
        callback: onMediaHotkey(() =>
          actions.setVolume(Math.max(0, volume - 0.1)),
        ),
      },
      { hotkey: "M", callback: onMediaHotkey(() => actions.toggleMute()) },
      {
        hotkey: "F",
        callback: onMediaHotkey(() => actions.toggleFullscreen()),
      },
      {
        hotkey: "Home",
        callback: onMediaHotkey(() => actions.jumpToStart?.()),
      },
      { hotkey: "End", callback: onMediaHotkey(() => actions.jumpToEnd?.()) },
      {
        hotkey: "J",
        callback: onMediaHotkey(() => actions.skipBackward?.(10)),
      },
      {
        hotkey: "L",
        callback: onMediaHotkey(() => actions.skipForward?.(10)),
      },
      {
        hotkey: ",",
        callback: onMediaHotkey(() => actions.skipBackward?.(1)),
      },
      {
        hotkey: ".",
        callback: onMediaHotkey(() => actions.skipForward?.(1)),
      },
      ...SEEK_PERCENT_HOTKEYS.map((hotkey) => ({
        hotkey,
        callback: onMediaHotkey(() => {
          const percent = Number(hotkey);
          actions.seek(percent === 0 ? 0 : duration * (percent / 10));
        }),
      })),
    ],
    // The wrapper must inspect the event before it is marked handled. TanStack
    // otherwise prevents it before invoking our callback, which makes the
    // `defaultPrevented` guard reject every registered shortcut.
    {
      enabled: isOpen,
      preventDefault: false,
      stopPropagation: false,
    },
  );
}
