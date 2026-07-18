/** Shared React Query options for hub-style Plex queries hydrated from SSR. */
export const PLEX_HUB_QUERY_OPTIONS = {
  // Match the default QueryClient freshness window so SSR hydration can carry
  // a warm home load without an immediate duplicate hub refetch.
  staleTime: 30_000,
  refetchOnWindowFocus: false,
} as const;

export function isHubQueryLoading(
  isPending: boolean,
  isFetching: boolean,
  itemCount: number,
): boolean {
  return (isPending || isFetching) && itemCount === 0;
}
