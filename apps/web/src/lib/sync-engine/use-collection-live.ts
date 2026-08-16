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

const EMPTY_ROWS: readonly { id: string }[] = Object.freeze([]);

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

const SERVER_SNAPSHOT: Snapshot<RowWithId> = Object.freeze({
  collection: undefined,
  version: -1,
  rows: EMPTY_ROWS as { id: string }[],
});

function subscribeStatusChange(
  collection: CollectionLike<RowWithId>,
  notify: () => void,
): () => void {
  if (typeof collection.on !== "function") {
    return () => undefined;
  }
  return collection.on("status:change", notify);
}

export function useCollectionRows<T extends RowWithId>(
  // Empty placeholder collections are typed as `{ id: string }` only.
  // Callers pass an explicit type argument for the real row shape.
  collection: CollectionLike<RowWithId> | null | undefined,
) {
  const typedCollection = collection as CollectionLike<T> | null | undefined;
  const versionRef = useRef(0);
  const snapshotRef = useRef<Snapshot<T> | null>(null);

  const subscribe = (onStoreChange: () => void): (() => void) => {
    if (!typedCollection) {
      return () => undefined;
    }

    typedCollection.startSyncImmediate();
    let unsubscribed = false;

    const notify = () => {
      if (unsubscribed) return;
      versionRef.current += 1;
      onStoreChange();
    };

    const subscription = typedCollection.subscribeChanges(notify);
    // Status transitions (idle → loading → ready/error) may not write rows;
    // subscribe so isLoading can clear even on empty collections.
    const unsubscribeStatus = subscribeStatusChange(typedCollection, notify);

    if (typedCollection.status === "ready") {
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
  };

  const getServerSnapshot = (): Snapshot<T> => SERVER_SNAPSHOT as Snapshot<T>;

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
) {
  const { data: rows, isLoading } = useCollectionRows<T>(collection);
  const data = id ? rows.find((row) => row.id === id) : undefined;

  return { data, isLoading };
}
