"use client";

import { useLiveQuery } from "@tanstack/react-db";

import {
  emptyContinueWatchingCollection,
  emptyHomeHubsCollection,
  emptyMediaItemsCollection,
  emptyServerLibrariesCollection,
  emptyServersCollection,
} from "./empty-collections";
import { useSyncEngineCollections } from "./provider";
import type {
  SanitizedContinueWatchingRow,
  SanitizedHomeHubRow,
  SanitizedMediaItemRow,
  SanitizedServerLibraryRow,
  SanitizedServerRow,
} from "./sanitize";

export function useSyncedServers(): {
  data: SanitizedServerRow[];
  isLoading: boolean;
  isReady: boolean;
} {
  const collections = useSyncEngineCollections();
  const { data = [], isLoading } = useLiveQuery(
    (q) =>
      q.from({
        servers: collections?.servers ?? emptyServersCollection,
      }),
    [collections],
  );

  return {
    data: collections ? (data as unknown as SanitizedServerRow[]) : [],
    isLoading: !collections || isLoading,
    isReady: Boolean(collections),
  };
}

export function useSyncedContinueWatching(): {
  data: SanitizedContinueWatchingRow[];
  isLoading: boolean;
  isReady: boolean;
} {
  const collections = useSyncEngineCollections();
  const { data = [], isLoading } = useLiveQuery(
    (q) =>
      q.from({
        items: collections?.continueWatching ?? emptyContinueWatchingCollection,
      }),
    [collections],
  );

  return {
    data: collections
      ? (data as unknown as SanitizedContinueWatchingRow[])
      : [],
    isLoading: !collections || isLoading,
    isReady: Boolean(collections),
  };
}

export function useSyncedHomeHubs(): {
  data: SanitizedHomeHubRow[];
  isLoading: boolean;
  isReady: boolean;
} {
  const collections = useSyncEngineCollections();
  const { data = [], isLoading } = useLiveQuery(
    (q) =>
      q.from({
        hubs: collections?.homeHubs ?? emptyHomeHubsCollection,
      }),
    [collections],
  );

  return {
    data: collections ? (data as unknown as SanitizedHomeHubRow[]) : [],
    isLoading: !collections || isLoading,
    isReady: Boolean(collections),
  };
}

export function useSyncedServerLibraries(): {
  data: SanitizedServerLibraryRow[];
  isLoading: boolean;
  isReady: boolean;
} {
  const collections = useSyncEngineCollections();
  const { data = [], isLoading } = useLiveQuery(
    (q) =>
      q.from({
        libraries:
          collections?.serverLibraries ?? emptyServerLibrariesCollection,
      }),
    [collections],
  );

  return {
    data: collections ? (data as unknown as SanitizedServerLibraryRow[]) : [],
    isLoading: !collections || isLoading,
    isReady: Boolean(collections),
  };
}

export function useSyncedMediaItems(): {
  data: SanitizedMediaItemRow[];
  isLoading: boolean;
  isReady: boolean;
} {
  const collections = useSyncEngineCollections();
  const { data = [], isLoading } = useLiveQuery(
    (q) =>
      q.from({
        items: collections?.mediaItems ?? emptyMediaItemsCollection,
      }),
    [collections],
  );

  return {
    data: collections ? (data as unknown as SanitizedMediaItemRow[]) : [],
    isLoading: !collections || isLoading,
    isReady: Boolean(collections),
  };
}
