/* ────────────────────────────────────────────────────────────
   Client Remux Logic
   Pure decision helpers for the in-browser remux engine. Kept free of DOM
   dependencies so the seek/buffer policies are unit-testable.
   ──────────────────────────────────────────────────────────── */

/** How far ahead of the playhead the engine buffers before pausing the pump. */
export const FORWARD_BUFFER_SECONDS = 60;
/** Forward window floor when the browser signals SourceBuffer quota pressure. */
export const MIN_FORWARD_BUFFER_SECONDS = 15;
/** How much already-played media is kept for instant backwards seeks. */
export const BACK_BUFFER_SECONDS = 30;
/**
 * A seek landing at most this far ahead of the pump's head waits for the pump
 * to catch up instead of restarting it (a restart re-fetches from a keyframe
 * and re-primes the audio pipeline, which is more expensive than waiting).
 */
export const SEEK_CATCH_UP_SECONDS = 12;
/** Tolerance when deciding whether a time is covered by a buffered range. */
export const SEEK_BUFFERED_TOLERANCE_SECONDS = 0.3;
/**
 * Maximum distance the video and audio feeders may run apart. Keeps the
 * muxer's interleaving memory bounded.
 */
export const INTERLEAVE_WINDOW_SECONDS = 3;

export interface BufferedRange {
  start: number;
  end: number;
}

/** Structural subset of the DOM `TimeRanges` interface. */
export interface TimeRangesLike {
  length: number;
  start(index: number): number;
  end(index: number): number;
}

export function bufferedToRanges(ranges: TimeRangesLike): BufferedRange[] {
  const result: BufferedRange[] = [];
  for (let index = 0; index < ranges.length; index += 1) {
    result.push({ start: ranges.start(index), end: ranges.end(index) });
  }
  return result;
}

/**
 * Whether `time` falls inside a buffered range. The end of a range is treated
 * conservatively: sitting exactly on a range's tail means the data needed to
 * keep playing is not actually buffered.
 */
export function isTimeBuffered(
  ranges: BufferedRange[],
  time: number,
  tolerance = SEEK_BUFFERED_TOLERANCE_SECONDS,
): boolean {
  return ranges.some(
    (range) => time >= range.start - tolerance && time <= range.end - 0.1,
  );
}

export interface PumpProgress {
  /** Timestamp the current pump started feeding from. */
  startTime: number;
  /** Lowest last-fed timestamp across the pump's active tracks. */
  feederHead: number;
  /** True once the pump has fed and appended the whole file. */
  finished: boolean;
}

/**
 * Decides whether a seek requires tearing down the current pump and
 * restarting it at the target, or whether the target is (or will shortly be)
 * covered by buffered data.
 */
export function shouldRestartPumpForSeek(options: {
  target: number;
  buffered: BufferedRange[];
  pump: PumpProgress | null;
}): boolean {
  const { target, buffered, pump } = options;

  if (isTimeBuffered(buffered, target)) {
    return false;
  }

  if (
    pump &&
    !pump.finished &&
    target >= pump.startTime - SEEK_BUFFERED_TOLERANCE_SECONDS &&
    target <= pump.feederHead + SEEK_CATCH_UP_SECONDS
  ) {
    // The pump is already converging on the target; let it catch up.
    return false;
  }

  return true;
}

/**
 * Computes the end of the range worth evicting behind the playhead, or null
 * when there is nothing meaningful to remove.
 */
export function computeEvictionEnd(options: {
  currentTime: number;
  keepBehindSeconds: number;
  earliestBufferedStart: number | null;
}): number | null {
  const { currentTime, keepBehindSeconds, earliestBufferedStart } = options;
  if (earliestBufferedStart === null) return null;

  const removeEnd = currentTime - keepBehindSeconds;
  // Skip sub-second evictions: SourceBuffer.remove is not free and tiny
  // removals just churn the queue.
  if (removeEnd <= earliestBufferedStart + 1) return null;
  return removeEnd;
}

/** Clamps a requested start position into the media's addressable range. */
export function clampPumpStartTime(
  startTime: number,
  duration: number | null,
): number {
  const upperBound =
    duration !== null && Number.isFinite(duration) && duration > 0
      ? Math.max(0, duration - 1)
      : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(0, startTime), upperBound);
}
