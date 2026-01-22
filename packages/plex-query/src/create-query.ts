import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
  type UseMutationOptions,
  type QueryKey,
} from "@tanstack/react-query";

/**
 * Configuration for creating a query hook
 */
type QueryConfig<TData, TParams, TError = Error> = {
  queryKey: (params: TParams) => QueryKey;
  queryFn: (params: TParams) => Promise<TData>;
  defaultOptions?: Omit<UseQueryOptions<TData, TError>, "queryKey" | "queryFn">;
};

/**
 * Configuration for creating a mutation hook
 */
type MutationConfig<TData, TParams, TError = Error> = {
  mutationFn: (params: TParams) => Promise<TData>;
  defaultOptions?: Omit<UseMutationOptions<TData, TError, TParams>, "mutationFn">;
};

/**
 * Return type for created query hooks
 */
type CreatedQuery<TData, TParams, TError = Error> = {
  useQuery: (
    params: TParams,
    options?: Omit<UseQueryOptions<TData, TError>, "queryKey" | "queryFn">
  ) => ReturnType<typeof useQuery<TData, TError>>;
  queryKey: (params: TParams) => QueryKey;
  queryFn: (params: TParams) => Promise<TData>;
  /** Prefetch data into the query cache */
  usePrefetch: () => (params: TParams) => Promise<void>;
};

/**
 * Return type for created mutation hooks
 */
type CreatedMutation<TData, TParams, TError = Error> = {
  useMutation: (
    options?: Omit<UseMutationOptions<TData, TError, TParams>, "mutationFn">
  ) => ReturnType<typeof useMutation<TData, TError, TParams>>;
};

/**
 * Create a type-safe query hook with tRPC-like API
 *
 * @example
 * ```ts
 * const getServers = createQuery({
 *   queryKey: (token) => plexKeys.servers(),
 *   queryFn: async (token) => {
 *     const client = new PlexTvClient(token, config);
 *     return client.getServers();
 *   },
 *   defaultOptions: { staleTime: 5 * 60 * 1000 },
 * });
 *
 * // Usage
 * const { data } = getServers.useQuery(token);
 * ```
 */
export function createQuery<TData, TParams, TError = Error>(
  config: QueryConfig<TData, TParams, TError>
): CreatedQuery<TData, TParams, TError> {
  return {
    useQuery: (params, options) => {
      return useQuery<TData, TError>({
        queryKey: config.queryKey(params),
        queryFn: () => config.queryFn(params),
        ...config.defaultOptions,
        ...options,
      });
    },
    queryKey: config.queryKey,
    queryFn: config.queryFn,
    usePrefetch: () => {
      const queryClient = useQueryClient();
      return async (params: TParams) => {
        await queryClient.prefetchQuery({
          queryKey: config.queryKey(params),
          queryFn: () => config.queryFn(params),
        });
      };
    },
  };
}

/**
 * Create a type-safe mutation hook with tRPC-like API
 *
 * @example
 * ```ts
 * const createPlayQueue = createMutation({
 *   mutationFn: async (params) => {
 *     const client = new PlexServerClient(params.server, params.token, config);
 *     return client.createPlayQueue(params);
 *   },
 * });
 *
 * // Usage
 * const mutation = createPlayQueue.useMutation();
 * await mutation.mutateAsync({ server, token, ... });
 * ```
 */
export function createMutation<TData, TParams, TError = Error>(
  config: MutationConfig<TData, TParams, TError>
): CreatedMutation<TData, TParams, TError> {
  return {
    useMutation: (options) => {
      return useMutation<TData, TError, TParams>({
        mutationFn: config.mutationFn,
        ...config.defaultOptions,
        ...options,
      });
    },
  };
}

/**
 * Create a query that depends on other queries being loaded first
 * Useful for aggregation queries that need multiple data sources
 */
export function createDependentQuery<TData, TParams, TError = Error>(
  config: QueryConfig<TData, TParams, TError> & {
    enabled?: (params: TParams) => boolean;
  }
): CreatedQuery<TData, TParams, TError> {
  return {
    useQuery: (params, options) => {
      const isEnabled = config.enabled?.(params) ?? true;
      return useQuery<TData, TError>({
        queryKey: config.queryKey(params),
        queryFn: () => config.queryFn(params),
        enabled: isEnabled,
        ...config.defaultOptions,
        ...options,
      });
    },
    queryKey: config.queryKey,
    queryFn: config.queryFn,
    usePrefetch: () => {
      const queryClient = useQueryClient();
      return async (params: TParams) => {
        await queryClient.prefetchQuery({
          queryKey: config.queryKey(params),
          queryFn: () => config.queryFn(params),
        });
      };
    },
  };
}
