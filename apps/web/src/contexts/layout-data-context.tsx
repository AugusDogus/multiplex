import { createContext, useContext, type ReactNode } from "react";
import {
  api,
  type PlexDevice,
  type PlexUserInfo,
  type ContinueWatchingItemWithServer,
} from "@multiplex/plex-query";

/* ────────────────────────────────────────────────────────────
   Layout Data Context
   Provides shared data fetched at the layout level to avoid
   waterfall fetching in child components.
   ──────────────────────────────────────────────────────────── */

interface LayoutDataContextValue {
  // Servers data
  servers: PlexDevice[];
  serversLoading: boolean;

  // User info data
  userInfo: PlexUserInfo | undefined;
  userInfoLoading: boolean;

  // Continue watching data
  continueWatchingItems: ContinueWatchingItemWithServer[];
  continueWatchingLoading: boolean;
  continueWatchingError: Error | null;

  // Combined loading states
  isLayoutLoading: boolean; // servers + userInfo loading
  isAllDataLoading: boolean; // all data loading
}

const LayoutDataContext = createContext<LayoutDataContextValue | null>(null);

interface LayoutDataProviderProps {
  token: string | null;
  children: ReactNode;
}

export function LayoutDataProvider({ token, children }: LayoutDataProviderProps) {
  // Fetch servers and userInfo in parallel
  const {
    data: servers = [],
    isLoading: serversLoading,
    isFetched: serversFetched,
  } = api.plex.getServers.useQuery(token, {
    enabled: !!token,
  });

  const {
    data: userInfo,
    isLoading: userInfoLoading,
    isFetched: userInfoFetched,
  } = api.plex.getUserInfo.useQuery(token, {
    enabled: !!token,
  });

  // Determine if continueWatching query can be enabled
  const canFetchContinueWatching = !!token && servers.length > 0 && !!userInfo;

  // Fetch continue watching - starts as soon as dependencies are ready
  const {
    data: continueWatchingItems = [],
    isLoading: continueWatchingLoading,
    isFetched: continueWatchingFetched,
    error: continueWatchingError,
  } = api.plex.getAllContinueWatching.useQuery(
    { token: token!, servers, userInfo: userInfo! },
    {
      enabled: canFetchContinueWatching,
    },
  );

  // Loading states that account for:
  // 1. No token yet (pre-hydration or not authenticated) - show skeletons
  // 2. Query is actively loading
  // 3. Query hasn't been fetched yet (waiting for dependencies)
  const isLayoutLoading =
    !token || serversLoading || userInfoLoading || !serversFetched || !userInfoFetched;

  // continueWatching is "loading" if:
  // 1. Layout is still loading (dependencies not ready)
  // 2. The query is actually loading
  // 3. Query hasn't been fetched yet
  const isContinueWatchingPending =
    isLayoutLoading || continueWatchingLoading || !continueWatchingFetched;
  const isAllDataLoading = isContinueWatchingPending;

  const value: LayoutDataContextValue = {
    servers,
    serversLoading,
    userInfo,
    userInfoLoading,
    continueWatchingItems,
    continueWatchingLoading,
    continueWatchingError: continueWatchingError as Error | null,
    isLayoutLoading,
    isAllDataLoading,
  };

  return <LayoutDataContext.Provider value={value}>{children}</LayoutDataContext.Provider>;
}

export function useLayoutData(): LayoutDataContextValue {
  const context = useContext(LayoutDataContext);
  if (!context) {
    throw new Error("useLayoutData must be used within a LayoutDataProvider");
  }
  return context;
}
