"use client";

export const MEDIA_PLAYER_DIAGNOSTIC_EVENT =
  "multiplex:media-player-diagnostic";

type MediaPlayerDiagnosticValue = boolean | number | string | null;

export interface MediaPlayerDiagnostic {
  readonly kind: string;
  readonly [key: string]: MediaPlayerDiagnosticValue;
}

declare global {
  interface Window {
    __multiplexMediaPlayerDiagnosticsEnabled?: boolean;
  }

  interface WindowEventMap {
    "multiplex:media-player-diagnostic": CustomEvent<MediaPlayerDiagnostic>;
  }
}

/** Emits secret-free player internals only when an E2E/debug client opts in. */
export function emitMediaPlayerDiagnostic(
  diagnostic: MediaPlayerDiagnostic,
): void {
  if (window.__multiplexMediaPlayerDiagnosticsEnabled !== true) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<MediaPlayerDiagnostic>(MEDIA_PLAYER_DIAGNOSTIC_EVENT, {
      detail: diagnostic,
    }),
  );
}
