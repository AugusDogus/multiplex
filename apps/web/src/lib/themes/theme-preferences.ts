import { z } from "zod";
import { BuiltInThemes } from "./built-in-themes";
import {
  importedThemeSchema,
  type ThemeResult,
  type VsCodeTheme,
} from "./vscode-theme";

export const themeStorageKey = "multiplex-themes-v1";
export const themeStyleId = "multiplex-custom-themes";
export const t3ChatSurfaceCss =
  "--surface-grain:var(--t3-chat-grain);--surface-grain-size:128px 128px;";
const schema = z
  .object({
    version: z.literal(1),
    themes: z.array(importedThemeSchema).max(100),
    light: z.string().nullable(),
    dark: z.string().nullable(),
  })
  .superRefine((value, context) => {
    if (
      new Set([...BuiltInThemes.all, ...value.themes].map((theme) => theme.id))
        .size !==
      value.themes.length + BuiltInThemes.all.length
    ) {
      context.addIssue({ code: "custom", message: "Duplicate theme IDs" });
    }
    for (const mode of ["light", "dark"] as const) {
      if (
        value[mode] !== null &&
        ![...BuiltInThemes.all, ...value.themes].some(
          (theme) => theme.id === value[mode] && theme.appearance === mode,
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "Selected theme is missing or has the wrong appearance",
        });
      }
    }
  });

export type ThemePreferences = z.infer<typeof schema>;
const empty: ThemePreferences = {
  version: 1,
  themes: [],
  light: null,
  dark: null,
};

function parse(raw: string | null): ThemeResult<ThemePreferences> {
  if (raw === null) return { ok: true, value: empty };
  try {
    const value: unknown = JSON.parse(raw);
    const result = schema.safeParse(value);
    if (result.success) return { ok: true, value: result.data };
  } catch {
    /* Report corrupt storage without overwriting it. */
  }
  return {
    ok: false,
    error:
      "Saved themes could not be read. Reload Multiplex or reset saved themes in Appearance. The stored data has not been overwritten.",
  };
}

function install(
  current: ThemePreferences,
  themes: VsCodeTheme[],
): ThemeResult<ThemePreferences> {
  // Re-imports get separate entries, preserving existing user choices.
  const next = { ...current, themes: [...current.themes, ...themes] };
  const result = schema.safeParse(next);
  return result.success
    ? { ok: true, value: result.data }
    : {
        ok: false,
        error:
          "These themes could not be saved. Multiplex supports up to 100 saved themes. Remove an unused theme and try again. Existing themes are unchanged.",
      };
}

function select(
  current: ThemePreferences,
  appearance: "light" | "dark",
  id: string | null,
): ThemePreferences {
  return { ...current, [appearance]: id };
}

function installAndSelect(
  current: ThemePreferences,
  themes: VsCodeTheme[],
): ThemeResult<ThemePreferences> {
  const installed = install(current, themes);
  if (!installed.ok) return installed;
  // Activate the first imported variant of each appearance for System mode.
  const light = themes.find((theme) => theme.appearance === "light");
  const dark = themes.find((theme) => theme.appearance === "dark");
  return {
    ok: true,
    value: {
      ...installed.value,
      light: light?.id ?? current.light,
      dark: dark?.id ?? current.dark,
    },
  };
}

function remove(current: ThemePreferences, id: string): ThemePreferences {
  return {
    ...current,
    themes: current.themes.filter((theme) => theme.id !== id),
    light: current.light === id ? null : current.light,
    dark: current.dark === id ? null : current.dark,
  };
}

function resolve(current: ThemePreferences, mode: "light" | "dark") {
  return [...BuiltInThemes.all, ...current.themes].find(
    (entry) => entry.id === current[mode] && entry.appearance === mode,
  );
}

function css(current: ThemePreferences): string {
  return (["light", "dark"] as const)
    .map((mode) => {
      const theme = resolve(current, mode);
      if (!theme) return "";
      return `:root.${mode}{${Object.entries(theme.colors)
        .filter(([, color]) => color !== undefined)
        .map(([key, color]) => `--${key}:${color};`)
        .join(
          "",
        )}${theme.id === `builtin:t3-chat:${mode}` ? t3ChatSurfaceCss : ""}}`;
    })
    .join("");
}

export const ThemePreferences = {
  empty,
  parse,
  install,
  installAndSelect,
  select,
  remove,
  resolve,
  css,
  schema,
} as const;
