import React from "react";

function useVisibilityChangeSubscribe(callback: () => void) {
  document.addEventListener("visibilitychange", callback);
  return () => {
    document.removeEventListener("visibilitychange", callback);
  };
}

function getVisibilityChangeSnapshot() {
  return document.visibilityState;
}

function getVisibilityChangeServerSnapshot() {
  return "visible";
}

/**
 * Hook that returns true when the page is visible, false when hidden
 * Uses useSyncExternalStore for efficient subscription to visibility changes
 */
export function useVisibilityChange() {
  const visibilityState = React.useSyncExternalStore(
    useVisibilityChangeSubscribe,
    getVisibilityChangeSnapshot,
    getVisibilityChangeServerSnapshot
  );

  return visibilityState === "visible";
}
