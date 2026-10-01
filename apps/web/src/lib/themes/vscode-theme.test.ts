import { describe, expect, test } from "bun:test";
import { VsCodeTheme } from "./vscode-theme";

describe("VS Code theme import", () => {
  test("reads JSONC and maps workbench colors onto Multiplex", () => {
    const result = VsCodeTheme.parse(
      `{
      // Exported from VS Code
      "name": "Night",
      "colors": {
        "editor.background": "#123",
        "editor.foreground": "#eeeeee",
        "sideBar.background": "#102030",
        "button.background": "#abcdef",
      },
    }`,
      "night.json",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.name).toBe("Night");
    expect(result.value.appearance).toBe("dark");
    expect(result.value.colors.background).toBe("#112233");
    expect(result.value.colors.sidebar).toBe("#102030");
    expect(result.value.colors.create).toBe("#abcdef");
  });

  test("flattens translucent colors onto their surface", () => {
    const result = VsCodeTheme.parse(
      JSON.stringify({
        colors: {
          "editor.background": "#000000",
          "sideBar.background": "#fff8",
          "list.hoverBackground": "#ffffff80",
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.colors.sidebar).toBe("#888888");
    expect(result.value.colors.accent).toBe("#808080");
    expect(result.value.colors["sidebar-accent"]).toBe("#c4c4c4");
  });

  test("keeps text readable when a dark theme supplies a light sidebar", () => {
    const result = VsCodeTheme.parse(
      JSON.stringify({
        name: "Mixed",
        colors: {
          "editor.background": "#111111",
          "sideBar.background": "#ffffff",
          "sideBar.foreground": "#eeeeee",
          "button.background": "#ffffff",
          "button.foreground": "#eeeeee",
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.colors["sidebar-foreground"]).toBe("#000000");
    expect(result.value.colors["primary-foreground"]).toBe("#000000");
  });

  test("infers light appearance and a name from the filename", () => {
    const result = VsCodeTheme.parse(
      '{"colors":{"editor.background":"#fff"}}',
      "paper-color-theme.json",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.appearance).toBe("light");
    expect(result.value.name).toBe("paper");
  });

  test.each([
    "{ invalid JSON",
    "null",
    "[]",
    '{"colors":{}}',
    '{"colors":{"editor.background":"url(https://example.com)"}}',
    '{"include":"./base.json","colors":{"editor.background":"#000"}}',
  ])(
    "rejects malformed or incomplete imports without a palette: %s",
    (source) => {
      expect(VsCodeTheme.parse(source).ok).toBe(false);
    },
  );
});
