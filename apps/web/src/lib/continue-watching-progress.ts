export interface ContinueWatchingProgressItem {
  readonly serverId: string;
  readonly ratingKey: string;
  readonly duration?: number;
  readonly viewOffset?: number;
  readonly progressPercent?: number;
  readonly isCompleted?: boolean;
  readonly timeRemaining?: number;
}

interface ContinueWatchingProgressIdentity {
  readonly serverId: string;
  readonly ratingKey: string;
}

export function updateContinueWatchingProgress<
  T extends ContinueWatchingProgressItem,
>(
  items: T[] | undefined,
  identity: ContinueWatchingProgressIdentity,
  timeSeconds: number,
  durationSeconds: number,
): T[] | undefined {
  if (
    !items ||
    !Number.isFinite(timeSeconds) ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return items;
  }

  const boundedTimeSeconds = Math.min(
    Math.max(0, timeSeconds),
    durationSeconds,
  );
  const measuredViewOffset = Math.round(boundedTimeSeconds * 1_000);
  const measuredDuration = Math.round(durationSeconds * 1_000);

  return items.map((item) =>
    item.serverId === identity.serverId && item.ratingKey === identity.ratingKey
      ? (() => {
          const effectiveDuration =
            item.duration !== undefined &&
            Number.isFinite(item.duration) &&
            item.duration > 0
              ? item.duration
              : measuredDuration;
          const viewOffset = Math.min(measuredViewOffset, effectiveDuration);

          return {
            ...item,
            duration: effectiveDuration,
            viewOffset,
            progressPercent: Math.round((viewOffset / effectiveDuration) * 100),
            isCompleted: viewOffset >= effectiveDuration * 0.9,
            timeRemaining: effectiveDuration - viewOffset,
          };
        })()
      : item,
  );
}

export function resetContinueWatchingProgress<
  T extends ContinueWatchingProgressItem,
>(
  items: T[] | undefined,
  identity: ContinueWatchingProgressIdentity,
): T[] | undefined {
  return items?.map((item) =>
    item.serverId === identity.serverId && item.ratingKey === identity.ratingKey
      ? {
          ...item,
          viewOffset: 0,
          progressPercent: 0,
          isCompleted: false,
          timeRemaining: item.duration,
        }
      : item,
  );
}
