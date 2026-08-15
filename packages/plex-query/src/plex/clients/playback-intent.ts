export type PlaybackIntent = {
  readonly beginPlay: () => number;
  readonly pause: () => void;
  readonly isCurrent: (revision: number) => boolean;
  readonly shouldPlay: () => boolean;
};

/**
 * Orders asynchronous media play requests against newer play/pause intent.
 * Browsers may resolve an earlier `video.play()` after a later pause. Adapters
 * use the returned revision to reject that stale completion.
 */
export const PlaybackIntent = {
  make: (): PlaybackIntent => {
    let revision = 0;
    let desiredPlayback = false;

    return {
      beginPlay: () => {
        revision += 1;
        desiredPlayback = true;
        return revision;
      },
      pause: () => {
        revision += 1;
        desiredPlayback = false;
      },
      isCurrent: (candidate) => revision === candidate,
      shouldPlay: () => desiredPlayback,
    };
  },
} as const;
