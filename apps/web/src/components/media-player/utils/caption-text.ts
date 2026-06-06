function isVttCue(cue: TextTrackCue): cue is VTTCue {
  return "text" in cue && typeof (cue as VTTCue).text === "string";
}

/**
 * Normalize SRT/VTT cue text for plain-text caption rendering.
 * Only normalizes common inline tags (br, i, b, u); other VTT markup is left
 * unchanged and may appear as raw text in the overlay.
 */
export function formatCaptionText(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?i>/gi, "")
    .replace(/<\/?b>/gi, "")
    .replace(/<\/?u>/gi, "")
    .trim();
}

export function getActiveCaptionLines(track: TextTrack | null): string[] {
  if (!track || track.mode === "disabled") return [];

  const activeCues = track.activeCues;
  if (!activeCues || activeCues.length === 0) return [];

  const lines: string[] = [];
  for (const cue of activeCues) {
    if (!cue || !isVttCue(cue)) continue;

    const formatted = formatCaptionText(cue.text);
    if (formatted) lines.push(formatted);
  }

  return lines;
}
