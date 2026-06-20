/**
 * Query options for client components seeded with server-rendered data.
 *
 * When SSR returns empty results (e.g. transient Plex server connection
 * failures right after sign-in), we must refetch on mount instead of
 * treating the empty array as fresh cached data.
 */
export function ssrSeededQueryOptions<TData extends readonly unknown[]>(
  initialData: TData,
  freshStaleTime: number,
) {
  const hasSsrData = initialData.length > 0;

  return {
    initialData,
    staleTime: hasSsrData ? freshStaleTime : 0,
    refetchOnMount: hasSsrData ? undefined : ("always" as const),
  };
}

export function isAwaitingSsrRetry<TData extends readonly unknown[]>(
  data: TData,
  isFetching: boolean,
) {
  return data.length === 0 && isFetching;
}
