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

export function useVisibilityChange() {
  const visibilityState = React.useSyncExternalStore(
    useVisibilityChangeSubscribe,
    getVisibilityChangeSnapshot,
    getVisibilityChangeServerSnapshot,
  );

  return visibilityState === "visible";
}
