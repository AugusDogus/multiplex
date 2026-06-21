/** Shared React Query options for hub-style Plex queries hydrated from SSR. */
export const PLEX_HUB_QUERY_OPTIONS = {
  // Hydrated data paints immediately; stale data refetches once on mount.
  staleTime: 0,
  refetchOnWindowFocus: false,
} as const;

export function isHubQueryLoading(
  isPending: boolean,
  isFetching: boolean,
  itemCount: number,
): boolean {
  return (isPending || isFetching) && itemCount === 0;
}
