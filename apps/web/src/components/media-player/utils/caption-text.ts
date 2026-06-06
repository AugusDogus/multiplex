/** Normalize SRT/VTT cue text for plain-text caption rendering. */
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
    if (!cue || !("text" in cue)) continue;

    const formatted = formatCaptionText((cue as VTTCue).text);
    if (formatted) lines.push(formatted);
  }

  return lines;
}
