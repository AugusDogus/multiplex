/** Shared helpers for hub-style Plex queries hydrated from SSR. */
export function isHubQueryLoading(
  isPending: boolean,
  isFetching: boolean,
  itemCount: number,
): boolean {
  return (isPending || isFetching) && itemCount === 0;
}
