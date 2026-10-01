// Adapted from T3 Code, MIT. See public/licenses/t3-code/NOTICE.
type ThemeAppearance = "light" | "dark";

export type ThemePreviewRenderSpec = Readonly<{
  baseTarget: string;
  baseWeight: number;
  accent: Readonly<{
    center: readonly [x: number, y: number];
    middleOffset: number;
    middleOpacity: number;
    endOffset: number;
  }>;
  action: Readonly<{
    center: readonly [x: number, y: number];
    startOpacity: number;
    endOffset: number;
  }>;
  scale: number;
  blurAt56Px: number;
}>;

/** Shared geometry and falloff for the web and native theme preview orbs. */
export const THEME_PREVIEW_RENDER_SPECS = {
  light: {
    baseTarget: "#ffffff",
    baseWeight: 0.8,
    accent: {
      center: [0.72, 0.22],
      middleOffset: 0.28,
      middleOpacity: 0.72,
      endOffset: 0.58,
    },
    action: {
      center: [0.18, 0.82],
      startOpacity: 0.45,
      endOffset: 0.55,
    },
    scale: 1.1,
    blurAt56Px: 3,
  },
  dark: {
    baseTarget: "#09090b",
    baseWeight: 0.8,
    accent: {
      center: [0.28, 0.78],
      middleOffset: 0.28,
      middleOpacity: 0.62,
      endOffset: 0.58,
    },
    action: {
      center: [0.82, 0.18],
      startOpacity: 0.45,
      endOffset: 0.55,
    },
    scale: 1.1,
    blurAt56Px: 3,
  },
} satisfies Readonly<Record<ThemeAppearance, ThemePreviewRenderSpec>>;
