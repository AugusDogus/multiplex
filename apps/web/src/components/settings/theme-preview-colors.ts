import type { VsCodeTheme } from "~/lib/themes/vscode-theme";
type ThemeAppearance = "light" | "dark";
export type ThemeCardPreviewColors = {
  sidebar: string;
  canvas: string;
  surface: string;
  accentSurface: string;
  accent: string;
  messageSurface: string;
  messageAction: string;
};

export const defaultPreviews = {
  light: {
    sidebar: "#fafafa",
    canvas: "#ffffff",
    surface: "#ffffff",
    accentSurface: "#f5f5f5",
    accent: "#171717",
    messageSurface: "#f5f5f5",
    messageAction: "#171717",
  },
  dark: {
    sidebar: "#171717",
    canvas: "#0a0a0a",
    surface: "#171717",
    accentSurface: "#262626",
    accent: "#e5e5e5",
    messageSurface: "#262626",
    messageAction: "#e5e5e5",
  },
} satisfies Record<ThemeAppearance, ThemeCardPreviewColors>;

export function previewColors(
  colors: VsCodeTheme["colors"],
): ThemeCardPreviewColors {
  return {
    sidebar: colors.sidebar,
    canvas: colors.background,
    surface: colors.card,
    accentSurface: colors.accent,
    accent: colors.primary,
    messageSurface: colors.secondary,
    messageAction: colors.primary,
  };
}
