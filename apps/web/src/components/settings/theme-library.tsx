"use client";

// Adapted from T3 Code's theme tiles and library cards, MIT.
// See public/licenses/t3-code/NOTICE.
import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { BuiltInThemes } from "~/lib/themes/built-in-themes";
import { ThemePreferences } from "~/lib/themes/theme-preferences";
import type { VsCodeTheme } from "~/lib/themes/vscode-theme";
import {
  defaultPreviews,
  previewColors,
  ThemeSwatch,
} from "./theme-preview-circles";
import { ThemeWireframe } from "./theme-wireframe";

export function AppearanceModes({
  mode,
  preferences,
  onChange,
  disabled,
}: {
  mode: string | undefined;
  preferences: ThemePreferences;
  onChange: (mode: string) => void;
  disabled: boolean;
}) {
  const colors = (appearance: "light" | "dark") => {
    const theme = ThemePreferences.resolve(preferences, appearance);
    return theme ? previewColors(theme.colors) : defaultPreviews[appearance];
  };
  return (
    <div className="space-y-3">
      <h3 className="text-muted-foreground text-sm font-medium text-balance">
        Color scheme
      </h3>
      <div
        role="group"
        aria-label="Appearance mode"
        className="grid grid-cols-3 gap-2 sm:gap-3"
      >
        {(["system", "light", "dark"] as const).map((appearance) => (
          <button
            key={appearance}
            type="button"
            disabled={disabled}
            className={cn(
              "bg-card/60 hover:bg-accent/20 focus-visible:ring-ring flex min-w-0 cursor-pointer flex-col items-stretch gap-2 rounded-[14px] border p-1.5 outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 sm:p-2",
              mode === appearance ? "border-ring" : "border-border/70",
            )}
            aria-label={
              appearance === "system"
                ? "Follow the system appearance"
                : `Use ${appearance} mode`
            }
            aria-pressed={mode === appearance}
            onClick={() => onChange(appearance)}
          >
            <ThemeWireframe
              className="h-16 sm:h-28 lg:h-36"
              panes={
                appearance === "system"
                  ? [
                      { clip: "left", colors: colors("light") },
                      { clip: "right", colors: colors("dark") },
                    ]
                  : [{ colors: colors(appearance) }]
              }
            />
            <span
              className={cn(
                "pb-0.5 text-center text-xs font-medium",
                mode === appearance
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {appearance === "system"
                ? "System"
                : appearance === "light"
                  ? "Light"
                  : "Dark"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PaletteCard({
  name,
  children,
  onRemove,
  disabled,
}: {
  name: string;
  children: ReactNode;
  onRemove?: () => void;
  disabled: boolean;
}) {
  return (
    <article className="border-border/70 bg-card/60 min-w-0 rounded-[14px] border">
      <div className="flex h-20 items-center justify-center gap-1.5 px-2 pt-2 sm:h-24 sm:gap-3 sm:px-3">
        {children}
      </div>
      <div className="flex h-10 items-center justify-between gap-2 px-3 pb-2">
        <h4 className="truncate text-sm font-medium" title={name}>
          {name}
        </h4>
        {onRemove && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground shrink-0"
            disabled={disabled}
            aria-label={`Remove ${name}`}
            title={`Remove ${name}`}
            onClick={onRemove}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </article>
  );
}

export function ThemeLibrary({
  preferences,
  onChoose,
  onRemove,
  disabled,
}: {
  preferences: ThemePreferences;
  onChoose: (appearance: "light" | "dark", id: string | null) => void;
  onRemove: (theme: VsCodeTheme) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
      <PaletteCard name="Multiplex" disabled={disabled}>
        {(["light", "dark"] as const).map((mode) => (
          <ThemeSwatch
            key={mode}
            name="Multiplex"
            mode={mode}
            colors={defaultPreviews[mode]}
            selected={!disabled && preferences[mode] === null}
            disabled={disabled}
            onSelect={() => onChoose(mode, null)}
          />
        ))}
      </PaletteCard>
      {BuiltInThemes.pairs.map((pair) => (
        <PaletteCard key={pair.id} name={pair.name} disabled={disabled}>
          {pair.themes.map((theme) => (
            <ThemeSwatch
              key={theme.id}
              name={pair.name}
              mode={theme.appearance}
              colors={previewColors(theme.colors)}
              selected={!disabled && preferences[theme.appearance] === theme.id}
              disabled={disabled}
              onSelect={() => onChoose(theme.appearance, theme.id)}
            />
          ))}
        </PaletteCard>
      ))}
      {preferences.themes.map((theme) => (
        <PaletteCard
          key={theme.id}
          name={theme.name}
          disabled={disabled}
          onRemove={() => onRemove(theme)}
        >
          <ThemeSwatch
            name={theme.name}
            mode={theme.appearance}
            colors={previewColors(theme.colors)}
            selected={!disabled && preferences[theme.appearance] === theme.id}
            disabled={disabled}
            onSelect={() => onChoose(theme.appearance, theme.id)}
          />
        </PaletteCard>
      ))}
    </div>
  );
}
