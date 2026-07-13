export function shouldClaimDirectSyncplaySeek(options: {
  readonly usesOffsetTimeline: boolean;
  readonly hasPendingResume: boolean;
}): boolean {
  return !options.usesOffsetTimeline && !options.hasPendingResume;
}
