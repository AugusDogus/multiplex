"use client";

import dynamic from "next/dynamic";

/**
 * The player graph (video element, stream planning, Effect runtime bindings) is
 * large. Keep it off the initial JS for browse/library/details until a user
 * actually opens playback — same product surface, less boot cost everywhere.
 */
export const MediaPlayerModalLazy = dynamic(
  () =>
    import("~/components/media-player/media-player-modal").then((mod) => ({
      default: mod.MediaPlayerModal,
    })),
  { ssr: false },
);
