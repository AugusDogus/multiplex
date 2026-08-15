/**
 * Format time in seconds to human-readable format (MM:SS or HH:MM:SS).
 */
export function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

/**
 * Returns the full media timeline duration for a stream that may have been
 * reloaded from an offset. Plex's offset transcode reports the duration of the
 * remaining stream, while player state and Syncplay positions use the full
 * episode timeline.
 */
export function getFullTimelineDuration(input: {
  mediaElementDuration: number;
  itemDurationMs: number | undefined;
  streamOffset: number;
}): number {
  const itemDurationSeconds = (input.itemDurationMs ?? 0) / 1000;
  if (Number.isFinite(itemDurationSeconds) && itemDurationSeconds > 0) {
    return itemDurationSeconds;
  }

  if (
    !Number.isFinite(input.mediaElementDuration) ||
    input.mediaElementDuration <= 0
  ) {
    return 0;
  }

  return Math.max(0, input.streamOffset) + input.mediaElementDuration;
}

/**
 * An offset exactly at EOF does not describe a playable transcode segment.
 * Keep the target inside the final half-second, which is also the point where
 * autoplay and Watch Together rotation treat playback as complete.
 */
export function clampPlayableSeekTarget(
  time: number,
  duration: number,
): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(time, Math.max(0, duration - 0.5)));
}
