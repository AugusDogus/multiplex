"use client";

import { useEffect, useState } from "react";
import { getActiveCaptionLines } from "../utils/caption-text";

export function useCaptionLines(track: TextTrack | null): string[] {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    if (!track) {
      setLines([]);
      return;
    }

    const handleCueChange = () => {
      setLines(getActiveCaptionLines(track));
    };

    track.addEventListener("cuechange", handleCueChange);
    handleCueChange();

    return () => {
      track.removeEventListener("cuechange", handleCueChange);
    };
  }, [track]);

  return lines;
}
