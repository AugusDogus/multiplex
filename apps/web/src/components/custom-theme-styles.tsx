"use client";

import { useEffect } from "react";
import { ThemePreferences, themeStyleId } from "~/lib/themes/theme-preferences";
import { useThemePreferences } from "~/lib/themes/theme-store";

export function CustomThemeStyles() {
  const snapshot = useThemePreferences();
  useEffect(() => {
    if (snapshot.status === "loading") return;
    const style = document.getElementById(themeStyleId);
    if (style)
      style.textContent =
        snapshot.status === "ready" ? ThemePreferences.css(snapshot.value) : "";
  }, [snapshot]);
  return null;
}
