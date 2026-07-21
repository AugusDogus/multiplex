"use client";

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

/**
 * SSR-safe subscription to a TanStack DB collection.
 *
 * `@tanstack/react-db`'s `useLiveQuery` calls `useSyncExternalStore` without
 * `getServerSnapshot`, which crashes Next.js App Router SSR ("Missing
 * getServerSnapshot"). Collections are browser/OPFS-only anyway, so the server
 * snapshot is always empty / loading.
 */

const EMPTY_ROWS: readonly { id: string }[] = Object.freeze([]);

type RowWithId = { id: string };

/** Structural collection surface we need — avoids empty-collection generics. */
type CollectionLike<T extends RowWithId> = {
  startSyncImmediate: () => void;
  subscribeChanges: (callback: () => void) => { unsubscribe: () => void };
  values: () => IterableIterator<T>;
  status: string;
};

type Snapshot<T extends RowWithId> = {
  collection: CollectionLike<T> | null | undefined;
  version: number;
  rows: T[];
};

export function useCollectionRows<T extends RowWithId>(
  // Empty placeholder collections are typed as `{ id: string }` only.
  // Callers pass an explicit type argument for the real row shape.
  collection: CollectionLike<RowWithId> | null | undefined,
): {
  data: T[];
  isLoading: boolean;
} {
  const typedCollection = collection as CollectionLike<T> | null | undefined;
  const versionRef = useRef(0);
  const snapshotRef = useRef<Snapshot<T> | null>(null);

  const serverSnapshot = useMemo(
    (): Snapshot<T> => ({
      collection: undefined,
      version: -1,
      rows: EMPTY_ROWS as T[],
    }),
    [],
  );

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!typedCollection) {
        return () => undefined;
      }

      typedCollection.startSyncImmediate();
      let unsubscribed = false;
      const subscription = typedCollection.subscribeChanges(() => {
        if (unsubscribed) return;
        versionRef.current += 1;
        onStoreChange();
      });

      if (typedCollection.status === "ready") {
        queueMicrotask(() => {
          if (unsubscribed) return;
          versionRef.current += 1;
          onStoreChange();
        });
      }

      return () => {
        unsubscribed = true;
        subscription.unsubscribe();
      };
    },
    [typedCollection],
  );

  const getSnapshot = useCallback(() => {
    const version = versionRef.current;
    if (
      snapshotRef.current &&
      snapshotRef.current.collection === typedCollection &&
      snapshotRef.current.version === version
    ) {
      return snapshotRef.current;
    }

    const next: Snapshot<T> = {
      collection: typedCollection,
      version,
      rows: typedCollection
        ? Array.from(typedCollection.values())
        : (EMPTY_ROWS as T[]),
    };
    snapshotRef.current = next;
    return next;
  }, [typedCollection]);

  const getServerSnapshot = useCallback(() => serverSnapshot, [serverSnapshot]);

  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const isLoading = Boolean(
    typedCollection &&
      (typedCollection.status === "idle" ||
        typedCollection.status === "loading"),
  );

  return { data: snapshot.rows, isLoading };
}

export function useCollectionRowById<T extends RowWithId>(
  collection: CollectionLike<RowWithId> | null | undefined,
  id: string | null | undefined,
): {
  data: T | undefined;
  isLoading: boolean;
} {
  const { data: rows, isLoading } = useCollectionRows<T>(collection);
  const data = useMemo(() => {
    if (!id) return undefined;
    return rows.find((row) => row.id === id);
  }, [id, rows]);

  return { data, isLoading };
}
