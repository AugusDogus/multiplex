import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { ThemePreferences } from "./theme-preferences";
import { VsCodeTheme } from "./vscode-theme";
import { themeBootScript } from "../../components/theme-boot";
import { BuiltInThemes } from "./built-in-themes";
import { importedThemeSchema } from "./vscode-theme";

function imported(name: string, background: string) {
  const result = VsCodeTheme.parse(
    JSON.stringify({ name, colors: { "editor.background": background } }),
  );
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("saved themes", () => {
  test("T3 Chat preserves distinct control colors before and after hydration", () => {
    const preferences = ThemePreferences.select(
      ThemePreferences.empty,
      "dark",
      "builtin:t3-chat:dark",
    );
    const theme = ThemePreferences.resolve(preferences, "dark");
    expect(theme?.colors).toMatchObject({
      background: "#1f1a24",
      "surface-raised": "#2c2631",
      placeholder: "#968d9f",
      "toolbar-control": "#362d3d",
      "toolbar-control-foreground": "#d4c7e1",
      "sidebar-muted-foreground": "#e7d0dd",
    });
    const style = { textContent: "" };
    runInNewContext(themeBootScript, {
      localStorage: { getItem: () => JSON.stringify(preferences) },
      document: { getElementById: () => style },
    });
    expect(style.textContent).toBe(ThemePreferences.css(preferences));
    expect(style.textContent).toContain("--placeholder:#968d9f;");
    expect(style.textContent).toContain("--surface-raised:#2c2631;");
    expect(style.textContent).toContain(
      "--surface-grain:var(--t3-chat-grain);",
    );
    expect(style.textContent).toContain("--surface-grain-size:128px 128px;");
  });

  test("rejects CSS injection through optional component colors at both boundaries", () => {
    const theme = imported("Night", "#111111");
    const raw = JSON.stringify({
      ...ThemePreferences.empty,
      dark: theme.id,
      themes: [
        {
          ...theme,
          colors: { ...theme.colors, placeholder: "red;}body{display:none}" },
        },
      ],
    });
    expect(ThemePreferences.parse(raw).ok).toBe(false);
    const style = { textContent: "" };
    runInNewContext(themeBootScript, {
      localStorage: { getItem: () => raw },
      document: { getElementById: () => style },
    });
    expect(style.textContent).toBe("");
  });

  test("built-in pairs persist independently and match the pre-paint palette", () => {
    expect(BuiltInThemes.pairs).toHaveLength(5);
    for (const pair of BuiltInThemes.pairs) {
      let preferences = ThemePreferences.empty;
      expect(pair.themes.map((theme) => theme.appearance)).toEqual([
        "light",
        "dark",
      ]);
      for (const theme of pair.themes) {
        expect(importedThemeSchema.safeParse(theme).success).toBe(true);
        preferences = ThemePreferences.select(
          preferences,
          theme.appearance,
          theme.id,
        );
        expect(ThemePreferences.resolve(preferences, theme.appearance)).toEqual(
          theme,
        );
        expect(
          ThemePreferences.parse(
            JSON.stringify({
              ...preferences,
              [theme.appearance === "light" ? "dark" : "light"]: theme.id,
            }),
          ).ok,
        ).toBe(false);
      }
      expect(preferences.themes).toEqual([]);
      expect(ThemePreferences.parse(JSON.stringify(preferences))).toEqual({
        ok: true,
        value: preferences,
      });
      const style = { textContent: "" };
      runInNewContext(themeBootScript, {
        localStorage: { getItem: () => JSON.stringify(preferences) },
        document: { getElementById: () => style },
      });
      expect(style.textContent).toBe(ThemePreferences.css(preferences));
      expect(style.textContent).toContain(":root.light{");
      expect(style.textContent).toContain(":root.dark{");
    }
  });

  test("round trips separate light and dark choices and clears only a removed selection", () => {
    const light = imported("Paper", "#ffffff");
    const dark = imported("Night", "#111111");
    const installed = ThemePreferences.install(ThemePreferences.empty, [
      light,
      dark,
    ]);
    if (!installed.ok) throw new Error(installed.error);
    const preferences = ThemePreferences.select(
      ThemePreferences.select(installed.value, "light", light.id),
      "dark",
      dark.id,
    );
    expect(ThemePreferences.parse(JSON.stringify(preferences))).toEqual({
      ok: true,
      value: preferences,
    });
    expect(ThemePreferences.remove(preferences, dark.id)).toEqual({
      ...preferences,
      dark: null,
      themes: [light],
    });
    expect(ThemePreferences.css(preferences)).toContain(
      ":root.light{--background:#ffffff;",
    );
    expect(ThemePreferences.css(preferences)).toContain(
      ":root.dark{--background:#111111;",
    );
  });

  test("rejects corrupt saved data, invalid colors, wrong modes, and duplicate IDs", () => {
    const dark = imported("Night", "#111111");
    for (const value of [
      { ...ThemePreferences.empty, themes: [dark], light: dark.id },
      { ...ThemePreferences.empty, themes: [dark, dark] },
      { ...ThemePreferences.empty, dark: "missing" },
      {
        ...ThemePreferences.empty,
        themes: [
          {
            ...dark,
            colors: {
              ...dark.colors,
              background: "red; } body { display:none",
            },
          },
        ],
      },
    ])
      expect(ThemePreferences.parse(JSON.stringify(value)).ok).toBe(false);
    expect(ThemePreferences.parse("bad json").ok).toBe(false);
  });

  test("boot palette matches runtime CSS and ignores injected CSS", () => {
    const theme = imported("</script><script>bad()</script>", "#123456");
    const preferences = {
      ...ThemePreferences.empty,
      themes: [theme],
      dark: theme.id,
    };
    const style = { textContent: "" };
    const run = (value: ThemePreferences) => {
      runInNewContext(themeBootScript, {
        localStorage: { getItem: () => JSON.stringify(value) },
        document: { getElementById: () => style },
      });
    };
    run(preferences);
    expect(style.textContent).toBe(ThemePreferences.css(preferences));
    run({
      ...preferences,
      themes: [
        {
          ...theme,
          colors: { ...theme.colors, background: "red;}body{display:none" },
        },
      ],
    });
    expect(style.textContent).toBe("");
  });
});

test("default preferences emit no color overrides", () => {
  expect(ThemePreferences.parse(null)).toEqual({
    ok: true,
    value: ThemePreferences.empty,
  });
  expect(ThemePreferences.css(ThemePreferences.empty)).toBe("");
});

test("boot rejects incomplete palettes and inconsistent saved selections", () => {
  const theme = imported("Night", "#112233");
  const values = [
    { ...ThemePreferences.empty, themes: [theme], light: theme.id },
    { ...ThemePreferences.empty, themes: [theme, theme], dark: theme.id },
    {
      ...ThemePreferences.empty,
      themes: [{ ...theme, colors: { background: "#112233" } }],
      dark: theme.id,
    },
  ];
  for (const value of values) {
    const style = { textContent: "stale styles" };
    runInNewContext(themeBootScript, {
      localStorage: { getItem: () => JSON.stringify(value) },
      document: { getElementById: () => style },
    });
    expect(style.textContent).toBe("");
    expect(ThemePreferences.parse(JSON.stringify(value)).ok).toBe(false);
  }
});
