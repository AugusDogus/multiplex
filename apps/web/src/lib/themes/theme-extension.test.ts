import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { ThemeExtension } from "./theme-extension";

function archive(path: string, files: Record<string, string>) {
  return zipSync(
    Object.fromEntries(
      Object.entries({
        "extension/package.json": JSON.stringify({
          contributes: {
            themes: [{ label: "Night", uiTheme: "vs-dark", path }],
          },
        }),
        ...files,
      }).map(([name, text]) => [name, strToU8(text)]),
    ),
  );
}

describe("theme extensions", () => {
  test("loads contributed themes with relative includes and local overrides", () => {
    const result = ThemeExtension.read(
      archive("./themes/night.json", {
        "extension/base.json":
          '{"colors":{"editor.background":"#123456","sideBar.background":"#234567"}}',
        "extension/themes/night.json":
          '{"include":"../base.json","colors":{"editor.background":"#111111"}}',
        "extension/run.js": 'throw new Error("Extension code must never run");',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value[0]?.name).toBe("Night");
    expect(result.value[0]?.colors.background).toBe("#111111");
    expect(result.value[0]?.colors.sidebar).toBe("#234567");
  });

  test.each([
    "../../outside.json",
    "/etc/passwd",
    "https://example.com/theme.json",
    "..\\outside.json",
  ])("rejects an include outside the package: %s", (include) => {
    expect(
      ThemeExtension.read(
        archive("themes/night.json", {
          "extension/themes/night.json": JSON.stringify({ include }),
        }),
      ).ok,
    ).toBe(false);
  });

  test("rejects cycles, missing theme files, malformed archives, and oversized JSON", () => {
    expect(
      ThemeExtension.read(
        archive("theme.json", {
          "extension/theme.json": '{"include":"theme.json"}',
        }),
      ).ok,
    ).toBe(false);
    expect(ThemeExtension.read(archive("missing.json", {})).ok).toBe(false);
    expect(ThemeExtension.read(new Uint8Array([1, 2, 3])).ok).toBe(false);
    expect(
      ThemeExtension.read(
        archive("theme.json", {
          "extension/theme.json": " ".repeat(1024 * 1024 + 1),
        }),
      ).ok,
    ).toBe(false);
  });
});
