"use client";

import { useRef, useSyncExternalStore } from "react";

/**
 * SSR-safe subscription to a TanStack DB collection.
 *
 * TanStack's stock `useLiveQuery` calls `useSyncExternalStore` without
 * `getServerSnapshot`, which crashes Next.js App Router SSR ("Missing
 * getServerSnapshot"). Collections are browser/OPFS-only anyway, so the server
 * snapshot is always empty / loading.
 */

type RowWithId = { id: string };

/** Structural collection surface we need — avoids empty-collection generics. */
type CollectionLike<T extends RowWithId> = {
  startSyncImmediate: () => void;
  subscribeChanges: (callback: () => void) => { unsubscribe: () => void };
  on?: (
    event: "status:change",
    callback: (event: { type: "status:change"; status: string }) => void,
  ) => () => void;
  values: () => IterableIterator<T>;
  status: string;
};

type Snapshot<T extends RowWithId> = {
  collection: CollectionLike<T> | null | undefined;
  version: number;
  rows: T[];
};

function subscribeStatusChange<T extends RowWithId>(
  collection: CollectionLike<T>,
  notify: () => void,
): () => void {
  if (!collection.on) {
    return () => undefined;
  }
  return collection.on("status:change", notify);
}

export function useCollectionRows<T extends RowWithId>(
  collection: CollectionLike<T> | null | undefined,
) {
  const versionRef = useRef(0);
  const snapshotRef = useRef<Snapshot<T> | null>(null);
  const serverSnapshotRef = useRef<Snapshot<T>>({
    collection: undefined,
    version: -1,
    rows: [],
  });

  const subscribe = (onStoreChange: () => void): (() => void) => {
    if (!collection) {
      return () => undefined;
    }

    collection.startSyncImmediate();
    let unsubscribed = false;

    const notify = () => {
      if (unsubscribed) return;
      versionRef.current += 1;
      onStoreChange();
    };

    const subscription = collection.subscribeChanges(notify);
    // Status transitions (idle → loading → ready/error) may not write rows;
    // subscribe so isLoading can clear even on empty collections.
    const unsubscribeStatus = subscribeStatusChange(collection, notify);

    if (collection.status === "ready") {
      queueMicrotask(notify);
    }

    return () => {
      unsubscribed = true;
      subscription.unsubscribe();
      unsubscribeStatus();
    };
  };

  const getSnapshot = (): Snapshot<T> => {
    const version = versionRef.current;
    if (
      snapshotRef.current &&
      snapshotRef.current.collection === collection &&
      snapshotRef.current.version === version
    ) {
      return snapshotRef.current;
    }

    const next: Snapshot<T> = {
      collection,
      version,
      rows: collection ? Array.from(collection.values()) : [],
    };
    snapshotRef.current = next;
    return next;
  };

  const getServerSnapshot = (): Snapshot<T> => serverSnapshotRef.current;

  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const isLoading = Boolean(
    collection &&
      (collection.status === "idle" || collection.status === "loading"),
  );

  return { data: snapshot.rows, isLoading };
}

export function useCollectionRowById<T extends RowWithId>(
  collection: CollectionLike<T> | null | undefined,
  id: string | null | undefined,
) {
  const { data: rows, isLoading } = useCollectionRows<T>(
    id ? collection : undefined,
  );
  const data = id ? rows.find((row) => row.id === id) : undefined;

  return { data, isLoading };
}
