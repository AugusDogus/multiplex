import React from "react";

function subscribeToVisibilityChange(callback: () => void) {
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

export function useVisibilityChange() {
  const visibilityState = React.useSyncExternalStore(
    subscribeToVisibilityChange,
    getVisibilityChangeSnapshot,
    getVisibilityChangeServerSnapshot,
  );

  return visibilityState === "visible";
}
