"use client";

import { useEffect, useState } from "react";
import { getActiveCaptionLines } from "../utils/caption-text";

export function useCaptionLines(track: TextTrack | null): string[] {
  const [activeTrackState, setActiveTrackState] = useState<{
    track: TextTrack;
    lines: string[];
  } | null>(null);

  useEffect(() => {
    if (!track) {
      return;
    }

    const handleCueChange = () => {
      setActiveTrackState({ track, lines: getActiveCaptionLines(track) });
    };

    track.addEventListener("cuechange", handleCueChange);

    return () => {
      track.removeEventListener("cuechange", handleCueChange);
    };
  }, [track]);

  if (!track) {
    return [];
  }

  return activeTrackState?.track === track
    ? activeTrackState.lines
    : getActiveCaptionLines(track);
}
