"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  createSyncEngineCollections,
  type SyncEngineCollections,
} from "./collections";
import { getSyncEnginePersistence } from "./persistence";
import { setActiveSyncEngineCollections } from "./registry";
import { getSyncEngineTrpcClient } from "./trpc-client";

export type SyncEngineStatus =
  | { phase: "booting" }
  | { phase: "ready"; collections: SyncEngineCollections; bootedAt: number }
  | { phase: "error"; error: string };

const SyncEngineContext = createContext<SyncEngineStatus>({ phase: "booting" });

async function cleanupCollections(
  collections: SyncEngineCollections,
): Promise<void> {
  await Promise.allSettled([
    collections.servers.cleanup(),
    collections.serverLibraries.cleanup(),
    collections.continueWatching.cleanup(),
    collections.homeHubs.cleanup(),
    collections.mediaItems.cleanup(),
    collections.watchTogetherRooms.cleanup(),
    collections.userInfo.cleanup(),
    collections.watchTogetherInvitees.cleanup(),
    collections.libraryHubs.cleanup(),
    collections.browsePages.cleanup(),
    collections.searchResults.cleanup(),
    collections.playlists.cleanup(),
    collections.playlistContents.cleanup(),
    collections.itemPlaylists.cleanup(),
    collections.libraryFilterValues.cleanup(),
    collections.playQueues.cleanup(),
  ]);
}

/**
 * Boots OPFS-backed TanStack DB collections once per browser tab.
 * Keep this under TRPCReactProvider so QueryClient is available.
 */
export function SyncEngineProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SyncEngineStatus>({ phase: "booting" });
  const collectionsRef = useRef<SyncEngineCollections | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { persistence } = await getSyncEnginePersistence();
        if (cancelled) return;

        const collections = createSyncEngineCollections({
          queryClient,
          trpc: getSyncEngineTrpcClient(),
          persistence,
        });
        collectionsRef.current = collections;
        setActiveSyncEngineCollections(collections);

        // Eager shell sync so revisits / soft-nav hit warm local rows.
        // Also preload on-demand collections so writeUpsert has a sync context
        // (otherwise Query Collections throw SyncNotInitializedError).
        void Promise.allSettled([
          collections.servers.preload(),
          collections.serverLibraries.preload(),
          collections.continueWatching.preload(),
          collections.homeHubs.preload(),
          collections.watchTogetherRooms.preload(),
          collections.userInfo.preload(),
          collections.mediaItems.preload(),
          collections.libraryHubs.preload(),
          collections.browsePages.preload(),
          collections.watchTogetherInvitees.preload(),
          collections.searchResults.preload(),
          collections.playlists.preload(),
          collections.playlistContents.preload(),
          collections.itemPlaylists.preload(),
          collections.libraryFilterValues.preload(),
          collections.playQueues.preload(),
        ]);

        if (cancelled) {
          setActiveSyncEngineCollections(null);
          await cleanupCollections(collections);
          collectionsRef.current = null;
          return;
        }

        setStatus({
          phase: "ready",
          collections,
          bootedAt: Date.now(),
        });
      } catch (error) {
        if (cancelled) return;
        setActiveSyncEngineCollections(null);
        setStatus({
          phase: "error",
          error:
            error instanceof Error
              ? error.message
              : "Failed to boot sync engine",
        });
      }
    })();

    return () => {
      cancelled = true;
      const collections = collectionsRef.current;
      collectionsRef.current = null;
      setActiveSyncEngineCollections(null);
      if (collections) {
        void cleanupCollections(collections);
      }
    };
  }, [queryClient]);

  return (
    <SyncEngineContext.Provider value={status}>
      {children}
    </SyncEngineContext.Provider>
  );
}

export function useSyncEngineStatus(): SyncEngineStatus {
  return useContext(SyncEngineContext);
}

export function useSyncEngineCollections(): SyncEngineCollections | null {
  const status = useSyncEngineStatus();
  return status.phase === "ready" ? status.collections : null;
}
