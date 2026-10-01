import { describe, expect, test } from "bun:test";
import { ThemeFiles } from "./theme-files";

const validTheme = JSON.stringify({
  name: "Night",
  colors: { "editor.background": "#111111" },
});

describe("theme file imports", () => {
  test("reads a batch without returning partial success for an invalid file", async () => {
    const valid = new File([validTheme], "night.json");
    expect(await ThemeFiles.read([valid])).toMatchObject({
      ok: true,
      value: [{ name: "Night", appearance: "dark" }],
    });
    expect(
      await ThemeFiles.read([valid, new File(["invalid"], "broken.json")]),
    ).toMatchObject({
      ok: false,
      error:
        "broken.json: The theme file contains invalid JSON. Fix the file and try again. Your current theme is unchanged.",
    });
  });

  test("returns an actionable failure when the browser cannot read a file", async () => {
    class UnreadableFile extends File {
      override async text(): Promise<string> {
        throw new Error("Read failed");
      }
    }
    expect(
      await ThemeFiles.read([new UnreadableFile([], "unreadable.json")]),
    ).toEqual({
      ok: false,
      error:
        "unreadable.json could not be read. Select the file again. Your saved themes are unchanged.",
    });
  });

  test("checks batch and file size limits before reading", async () => {
    const file = new File([validTheme], "night.json");
    expect(
      await ThemeFiles.read(Array.from({ length: 41 }, () => file)),
    ).toEqual({ ok: false, error: "Import up to 40 theme files at a time." });
    expect(
      await ThemeFiles.read([
        new File([new Uint8Array(1024 * 1024 + 1)], "large.json"),
      ]),
    ).toMatchObject({
      ok: false,
      error: "large.json is larger than 1 MB. Choose a smaller theme file.",
    });
  });
});
