import { useSyncExternalStore } from "react";

const LARGE_SCREEN_QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void) {
  const mediaQuery = window.matchMedia(LARGE_SCREEN_QUERY);
  mediaQuery.addEventListener("change", onChange);
  return () => mediaQuery.removeEventListener("change", onChange);
}

function getSnapshot() {
  return window.matchMedia(LARGE_SCREEN_QUERY).matches;
}

function getServerSnapshot() {
  return true;
}

export function useIsLargeScreen() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
