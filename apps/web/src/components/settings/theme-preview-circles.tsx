// Adapted from T3 Code, MIT. See public/licenses/t3-code/NOTICE.
import { MoonIcon, SunIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "~/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { THEME_PREVIEW_RENDER_SPECS } from "./theme-preview-spec";

import type { ThemeCardPreviewColors } from "./theme-preview-colors";

type ThemeAppearance = "light" | "dark";

// Interpolating in oklab keeps the glow falloff perceptually even (no gray
// mid-tones or banding rings), and premultiplied alpha keeps the fade to
// transparent clean.
function getThemePreviewStyle(
  colors: ThemeCardPreviewColors,
  mode: ThemeAppearance,
): CSSProperties {
  const spec = THEME_PREVIEW_RENDER_SPECS[mode];
  // The canvas carries the ball's light/dark identity, so it stays dominant:
  // a near-true base with a contained accent glow, instead of an accent wash
  // that makes both modes read alike.
  const modeBase = `color-mix(in oklab, ${colors.canvas} ${spec.baseWeight * 100}%, ${spec.baseTarget})`;
  const accentPosition = `${spec.accent.center[0] * 100}% ${spec.accent.center[1] * 100}%`;
  const actionPosition = `${spec.action.center[0] * 100}% ${spec.action.center[1] * 100}%`;
  return {
    backgroundColor: modeBase,
    backgroundImage: [
      `radial-gradient(circle at ${accentPosition} in oklab, ${colors.accent} 0%, color-mix(in oklab, ${colors.accent} ${spec.accent.middleOpacity * 100}%, transparent) ${spec.accent.middleOffset * 100}%, transparent ${spec.accent.endOffset * 100}%)`,
      // The action color is a soft tint from the opposite corner, not a second
      // light source, two bright hotspots read as headlights.
      `radial-gradient(circle at ${actionPosition} in oklab, color-mix(in oklab, ${colors.messageAction} ${spec.action.startOpacity * 100}%, transparent) 0%, transparent ${spec.action.endOffset * 100}%)`,
    ].join(", "),
  };
}

// The gradient halves of each ball can match the card surface, so every ball
// carries a faint mode-appropriate inner ring to keep its silhouette legible.
function themePreviewEdgeShadow(mode: ThemeAppearance): string {
  return mode === "dark"
    ? "inset 0 0 0 1px rgb(255 255 255 / 0.14), 0 1px 2px rgb(0 0 0 / 0.18)"
    : "inset 0 0 0 1px rgb(0 0 0 / 0.10), 0 1px 2px rgb(0 0 0 / 0.08)";
}

export function ThemePreviewCircle({
  colors,
  mode,
}: {
  colors: ThemeCardPreviewColors;
  mode: ThemeAppearance;
}) {
  return (
    <span
      aria-hidden
      className="border-background relative block size-12 shrink-0 overflow-hidden rounded-full border-2 sm:size-14"
      style={{ boxShadow: themePreviewEdgeShadow(mode) }}
    >
      <span
        className="absolute inset-0 rounded-full"
        style={{
          ...getThemePreviewStyle(colors, mode),
          filter: `blur(${THEME_PREVIEW_RENDER_SPECS[mode].blurAt56Px}px)`,
          transform: `scale(${THEME_PREVIEW_RENDER_SPECS[mode].scale})`,
        }}
      />
    </span>
  );
}

export function ThemeSwatch({
  name,
  mode,
  colors,
  selected,
  disabled,
  onSelect,
}: {
  name: string;
  mode: ThemeAppearance;
  colors: ThemeCardPreviewColors;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`Use ${name} for ${mode} mode`}
            aria-pressed={selected}
            disabled={disabled}
            onClick={onSelect}
            className={cn(
              "focus-visible:ring-ring focus-visible:ring-offset-card relative flex size-14 shrink-0 cursor-pointer items-center justify-center rounded-full p-1 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 sm:size-16",
              selected && "ring-ring ring-2",
            )}
          >
            <ThemePreviewCircle colors={colors} mode={mode} />
            {selected && (
              <span
                aria-hidden="true"
                className="bg-background text-foreground pointer-events-none absolute right-0 bottom-0 flex size-5 items-center justify-center rounded-full border shadow-sm"
              >
                {mode === "light" ? (
                  <SunIcon className="size-3" />
                ) : (
                  <MoonIcon className="size-3" />
                )}
              </span>
            )}
          </button>
        }
      />
      <TooltipContent>
        {mode === "light" ? "Use for light mode" : "Use for dark mode"}
      </TooltipContent>
    </Tooltip>
  );
}
