import { parse, type ParseError } from "jsonc-parser";
import { z } from "zod";
import { ThemeColor } from "./theme-color";

export type ThemeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export const themeColorKeys = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "create",
  "create-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
] as const;

const hexColor = z.string().regex(/^#[\da-f]{6}$/i);

// T3's component roles are optional so previously saved VS Code themes remain valid.
const chromeColors = z.object({
  "surface-raised": hexColor.optional(),
  placeholder: hexColor.optional(),
  "secondary-label": hexColor.optional(),
  "icon-muted": hexColor.optional(),
  "toolbar-background": hexColor.optional(),
  "toolbar-foreground": hexColor.optional(),
  "toolbar-border": hexColor.optional(),
  "toolbar-control": hexColor.optional(),
  "toolbar-control-foreground": hexColor.optional(),
  "toolbar-control-hover": hexColor.optional(),
  "sidebar-muted-foreground": hexColor.optional(),
  "sidebar-control-surface": hexColor.optional(),
  "sidebar-row-hover": hexColor.optional(),
  "sidebar-row-active": hexColor.optional(),
  "sidebar-row-selected": hexColor.optional(),
  "destructive-foreground": hexColor.optional(),
});
export const themeChromeKeys = chromeColors.keyof().options;

export const importedThemeSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(80),
  appearance: z.enum(["light", "dark"]),
  colors: z
    .object({
      background: hexColor,
      foreground: hexColor,
      card: hexColor,
      "card-foreground": hexColor,
      popover: hexColor,
      "popover-foreground": hexColor,
      primary: hexColor,
      "primary-foreground": hexColor,
      create: hexColor,
      "create-foreground": hexColor,
      secondary: hexColor,
      "secondary-foreground": hexColor,
      muted: hexColor,
      "muted-foreground": hexColor,
      accent: hexColor,
      "accent-foreground": hexColor,
      destructive: hexColor,
      border: hexColor,
      input: hexColor,
      ring: hexColor,
      sidebar: hexColor,
      "sidebar-foreground": hexColor,
      "sidebar-primary": hexColor,
      "sidebar-primary-foreground": hexColor,
      "sidebar-accent": hexColor,
      "sidebar-accent-foreground": hexColor,
      "sidebar-border": hexColor,
      "sidebar-ring": hexColor,
    })
    .merge(chromeColors),
});
export type VsCodeTheme = z.infer<typeof importedThemeSchema>;

const sourceSchema = z.object({
  name: z.string().optional(),
  displayName: z.string().optional(),
  type: z.string().optional(),
  include: z.string().optional(),
  colors: z.record(z.string()),
});

const MAX_BYTES = 1024 * 1024;

function fromObject(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- boundary: validate imported JSON before use.
  value: unknown,
  filename = "VS Code theme",
): ThemeResult<VsCodeTheme> {
  const source = sourceSchema.safeParse(value);
  if (!source.success)
    return {
      ok: false,
      error: "Choose a VS Code color theme containing a colors object.",
    };
  if (source.data.include)
    return {
      ok: false,
      error:
        "This theme depends on another file. Import its extension from community search, or export a complete theme from VS Code using ‘Generate Color Theme From Current Settings’. Your current theme is unchanged.",
    };
  const { colors } = source.data;
  const canvas = ThemeColor.parse(
    colors["editor.background"] ?? colors["editorPane.background"],
  );
  if (!canvas)
    return {
      ok: false,
      error:
        "The theme needs a valid editor.background hex color. Export a complete color theme from VS Code and try again.",
    };
  const background = { ...canvas, a: 1 };
  const type = source.data.type?.toLowerCase();
  const appearance =
    type === "light" || type === "hc-light"
      ? "light"
      : type === "dark" || type === "hc-black"
        ? "dark"
        : ThemeColor.luminance(background) < 0.179
          ? "dark"
          : "light";
  const text =
    appearance === "dark"
      ? { r: 238, g: 238, b: 238, a: 1 }
      : { r: 32, g: 32, b: 32, a: 1 };
  const pick = (
    base: typeof background,
    fallback: typeof background,
    ...keys: string[]
  ) => {
    for (const key of keys) {
      const color = ThemeColor.parse(colors[key]);
      if (color) return ThemeColor.flatten(color, base);
    }
    return fallback;
  };
  const mix = (base: typeof background, alpha: number) =>
    ThemeColor.flatten({ ...text, a: alpha }, base);
  const foreground = ThemeColor.readable(
    background,
    pick(background, text, "editor.foreground", "foreground"),
  );
  const card = pick(
    background,
    mix(background, 0.035),
    "editorWidget.background",
  );
  const popover = pick(
    background,
    card,
    "menu.background",
    "quickInput.background",
    "dropdown.background",
  );
  const sidebar = pick(
    background,
    mix(background, 0.025),
    "sideBar.background",
    "activityBar.background",
  );
  const primary = pick(
    background,
    foreground,
    "button.background",
    "focusBorder",
    "textLink.foreground",
  );
  const primaryText = ThemeColor.readable(
    primary,
    pick(primary, foreground, "button.foreground"),
  );
  const secondary = pick(
    background,
    mix(background, 0.08),
    "button.secondaryBackground",
  );
  const accent = pick(
    background,
    mix(background, 0.1),
    "list.hoverBackground",
    "list.activeSelectionBackground",
  );
  const sidebarAccent = pick(
    sidebar,
    mix(sidebar, 0.1),
    "list.inactiveSelectionBackground",
    "list.hoverBackground",
  );
  const border = pick(
    background,
    mix(background, 0.15),
    "panel.border",
    "editorGroup.border",
    "contrastBorder",
  );
  const ring = pick(background, primary, "focusBorder");
  const hex = ThemeColor.hex;
  const readable = (base: typeof background, ...keys: string[]) =>
    hex(ThemeColor.readable(base, pick(base, foreground, ...keys)));
  const name =
    [
      source.data.displayName,
      source.data.name,
      filename.replace(/(?:-color-theme)?\.jsonc?$/i, ""),
    ]
      .map((value) => value?.trim())
      .find((value) => value !== undefined && value.length > 0)
      ?.slice(0, 80) ?? "VS Code theme";
  return {
    ok: true,
    value: {
      id: crypto.randomUUID(),
      name,
      appearance,
      colors: {
        background: hex(background),
        foreground: hex(foreground),
        card: hex(card),
        "card-foreground": readable(card, "editorWidget.foreground"),
        popover: hex(popover),
        "popover-foreground": readable(
          popover,
          "menu.foreground",
          "dropdown.foreground",
        ),
        primary: hex(primary),
        "primary-foreground": hex(primaryText),
        create: hex(primary),
        "create-foreground": hex(primaryText),
        secondary: hex(secondary),
        "secondary-foreground": readable(
          secondary,
          "button.secondaryForeground",
        ),
        muted: hex(card),
        "muted-foreground": readable(background, "descriptionForeground"),
        accent: hex(accent),
        "accent-foreground": readable(accent, "list.hoverForeground"),
        destructive: hex(
          ThemeColor.readable(
            background,
            pick(
              background,
              appearance === "dark"
                ? { r: 252, g: 165, b: 165, a: 1 }
                : { r: 185, g: 28, b: 28, a: 1 },
              "errorForeground",
              "editorError.foreground",
            ),
          ),
        ),
        border: hex(border),
        input: hex(pick(background, border, "input.border", "dropdown.border")),
        ring: hex(ring),
        sidebar: hex(sidebar),
        "sidebar-foreground": readable(sidebar, "sideBar.foreground"),
        "sidebar-primary": hex(primary),
        "sidebar-primary-foreground": hex(primaryText),
        "sidebar-accent": hex(sidebarAccent),
        "sidebar-accent-foreground": readable(
          sidebarAccent,
          "list.inactiveSelectionForeground",
          "sideBar.foreground",
        ),
        "sidebar-border": hex(pick(sidebar, border, "sideBar.border")),
        "sidebar-ring": hex(ring),
      },
    },
  };
}

function parseTheme(
  source: string,
  filename?: string,
): ThemeResult<VsCodeTheme> {
  if (new TextEncoder().encode(source).length > MAX_BYTES)
    return {
      ok: false,
      error:
        "Theme files must be smaller than 1 MB. Export just the color theme and try again.",
    };
  const errors: ParseError[] = [];
  const value: unknown = parse(source.replace(/^\uFEFF/, ""), errors, {
    allowTrailingComma: true,
  });
  if (errors.length)
    return {
      ok: false,
      error:
        "The theme file contains invalid JSON. Fix the file and try again. Your current theme is unchanged.",
    };
  return fromObject(value, filename);
}

export const VsCodeTheme = {
  parse: parseTheme,
  fromObject,
  maxBytes: MAX_BYTES,
} as const;
