export interface SrtCue {
  startTime: number;
  endTime: number;
  text: string;
}

function parseSrtTimestamp(timestamp: string): number | null {
  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(timestamp);
  if (!match) return null;

  const [, hours, minutes, seconds, milliseconds] = match;
  return (
    Number(hours) * 60 * 60 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(milliseconds) / 1000
  );
}

export function parseSrtCues(srtText: string): SrtCue[] {
  const blocks = srtText
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n{2,}/);

  return blocks.flatMap((block) => {
    const lines = block
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);
    const timingLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingLineIndex === -1) return [];

    const timingLine = lines[timingLineIndex];
    if (!timingLine) return [];

    const [startRaw, endRaw] = timingLine
      .split("-->")
      .map((part) => part.trim().split(/\s+/)[0]);
    const startTime = startRaw ? parseSrtTimestamp(startRaw) : null;
    const endTime = endRaw ? parseSrtTimestamp(endRaw) : null;
    if (startTime === null || endTime === null || endTime <= startTime) {
      return [];
    }

    const text = lines.slice(timingLineIndex + 1).join("\n");
    if (!text) return [];

    return [{ startTime, endTime, text }];
  });
}

/** Map subtitle cues from the original timeline onto a stream-local timeline. */
export function shiftSrtCues(cues: SrtCue[], offsetSeconds: number): SrtCue[] {
  if (offsetSeconds <= 0) return cues;

  return cues.flatMap((cue) => {
    const startTime = cue.startTime - offsetSeconds;
    const endTime = cue.endTime - offsetSeconds;
    if (endTime <= 0 || endTime <= startTime) return [];

    return [{ startTime: Math.max(0, startTime), endTime, text: cue.text }];
  });
}
