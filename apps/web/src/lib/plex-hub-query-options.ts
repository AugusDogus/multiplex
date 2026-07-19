/** Shared React Query options for hub-style Plex queries hydrated from SSR. */
export const PLEX_HUB_QUERY_OPTIONS = {
  // Long enough that library/home soft-nav revisits paint from cache like Plex.
  staleTime: 2 * 60 * 1000,
  refetchOnWindowFocus: false,
} as const;

export function isHubQueryLoading(
  isPending: boolean,
  isFetching: boolean,
  itemCount: number,
): boolean {
  return (isPending || isFetching) && itemCount === 0;
}
