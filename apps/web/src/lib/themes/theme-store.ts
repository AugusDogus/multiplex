"use client";

import { useSyncExternalStore } from "react";
import { ThemePreferences, themeStorageKey } from "./theme-preferences";
import type { ThemeResult } from "./vscode-theme";

type Snapshot =
  | { status: "loading" }
  | { status: "ready"; value: ThemePreferences }
  | { status: "error"; error: string };
const serverSnapshot: Snapshot = { status: "loading" };
let cachedRaw: string | null | undefined;
let cachedSnapshot: Snapshot = serverSnapshot;
const listeners = new Set<() => void>();

function getSnapshot(): Snapshot {
  try {
    const raw = localStorage.getItem(themeStorageKey);
    if (cachedRaw === raw && cachedSnapshot.status !== "loading")
      return cachedSnapshot;
    cachedRaw = raw;
    const parsed = ThemePreferences.parse(raw);
    cachedSnapshot = parsed.ok
      ? { status: "ready", value: parsed.value }
      : { status: "error", error: parsed.error };
  } catch {
    cachedRaw = undefined;
    if (cachedSnapshot.status !== "error")
      cachedSnapshot = {
        status: "error",
        error:
          "Browser storage is unavailable. Allow site storage and reload to save or change custom themes.",
      };
  }
  return cachedSnapshot;
}

function notify() {
  for (const listener of listeners) listener();
}
function onStorage(event: StorageEvent) {
  if (event.key === null || event.key === themeStorageKey) notify();
}
function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function save(value: ThemePreferences): ThemeResult<ThemePreferences> {
  const parsed = ThemePreferences.schema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      error:
        "The theme selection is invalid. Reload and choose an installed theme. Existing themes are unchanged.",
    };
  try {
    localStorage.setItem(themeStorageKey, JSON.stringify(parsed.data));
    notify();
    return { ok: true, value: parsed.data };
  } catch {
    return {
      ok: false,
      error:
        "The theme could not be saved. Browser storage may be full or disabled. Free some site storage and try again. Your previous theme is unchanged.",
    };
  }
}

function update(
  change: (value: ThemePreferences) => ThemeResult<ThemePreferences>,
): ThemeResult<ThemePreferences> {
  const snapshot = getSnapshot();
  if (snapshot.status !== "ready")
    return {
      ok: false,
      error:
        snapshot.status === "error"
          ? snapshot.error
          : "Themes are still loading. Try again shortly.",
    };
  const next = change(snapshot.value);
  return next.ok ? save(next.value) : next;
}

export function useThemePreferences() {
  return useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
}

export const ThemeStore = {
  update,
  reset: () => save(ThemePreferences.empty),
} as const;
