"use client";

import { useSyncExternalStore } from "react";

type Listener = () => void;

const listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined") {
    window.addEventListener("online", listener);
    window.addEventListener("offline", listener);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", listener);
      window.removeEventListener("offline", listener);
    }
  };
}

function getSnapshot(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

function getServerSnapshot(): boolean {
  return true;
}

/** Browser online/offline for sync-status UI. */
export function useNavigatorOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
