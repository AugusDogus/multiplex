"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  createSyncEngineCollections,
  type SyncEngineCollections,
} from "./collections";
import { getSyncEnginePersistence } from "./persistence";
import {
  getActiveSyncEngineCollections,
  setActiveSyncEngineCollections,
  subscribeActiveSyncEngineCollections,
} from "./registry";
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

type SyncEngineProviderProps = {
  children: ReactNode;
  /** Better Auth user id — scopes the OPFS database per account. */
  userId: string | null;
  isSessionPending?: boolean;
};

/**
 * Boots OPFS-backed TanStack DB collections once per browser tab / account.
 * Keep this under TRPCReactProvider so QueryClient is available.
 */
export function SyncEngineProvider({
  children,
  userId,
  isSessionPending = false,
}: SyncEngineProviderProps) {
  const queryClient = useQueryClient();
  const [bootStatus, setBootStatus] = useState<
    SyncEngineStatus & { userId?: string | null }
  >({
    phase: "booting",
  });
  const collectionsRef = useRef<SyncEngineCollections | null>(null);

  // Logout calls clearSyncEngineSession() which nulls the registry before the
  // session cookie flips. Derive status from the registry so React never keeps
  // handing out disposed collections.
  const activeCollections = useSyncExternalStore(
    subscribeActiveSyncEngineCollections,
    getActiveSyncEngineCollections,
    () => null,
  );

  const status = useMemo<SyncEngineStatus>(() => {
    if (isSessionPending) return { phase: "booting" };
    if (!userId) {
      return {
        phase: "error",
        error: "Sync engine requires a signed-in session",
      };
    }
    // Registry cleared (logout) while bootStatus may still say ready.
    if (activeCollections === null) {
      return { phase: "booting" };
    }
    // Avoid briefly exposing the previous account's collections after switch.
    if (bootStatus.userId && bootStatus.userId !== userId) {
      return { phase: "booting" };
    }
    if (
      bootStatus.phase === "ready" &&
      bootStatus.collections === activeCollections
    ) {
      return {
        phase: "ready",
        collections: bootStatus.collections,
        bootedAt: bootStatus.bootedAt,
      };
    }
    if (bootStatus.phase === "error") {
      return { phase: "error", error: bootStatus.error };
    }
    return { phase: "booting" };
  }, [activeCollections, bootStatus, isSessionPending, userId]);

  useEffect(() => {
    let cancelled = false;

    if (isSessionPending || !userId) {
      const collections = collectionsRef.current;
      collectionsRef.current = null;
      setActiveSyncEngineCollections(null);
      if (collections) {
        void cleanupCollections(collections);
      }
      return;
    }

    void (async () => {
      try {
        const { persistence } = await getSyncEnginePersistence(userId);
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
        // allSettled swallows individual preload rejections.
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

        setBootStatus({
          phase: "ready",
          collections,
          bootedAt: Date.now(),
          userId,
        });
      } catch (error) {
        if (cancelled) return;
        setActiveSyncEngineCollections(null);
        setBootStatus({
          phase: "error",
          error:
            error instanceof Error
              ? error.message
              : "Failed to boot sync engine",
          userId,
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
  }, [queryClient, userId, isSessionPending]);

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
  const activeCollections = useSyncExternalStore(
    subscribeActiveSyncEngineCollections,
    getActiveSyncEngineCollections,
    () => null,
  );
  if (status.phase !== "ready") return null;
  // Never return collections after logout teardown cleared the registry.
  if (activeCollections !== status.collections) return null;
  return status.collections;
}
