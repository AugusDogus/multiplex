import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { OpenVsxThemes } from "./open-vsx-themes";

const extension = {
  namespace: "example",
  name: "night",
  displayName: "Night",
  files: {
    download: "https://open-vsx.org/api/example/night/1.0/file/theme.vsix",
  },
};

const signal = () => new AbortController().signal;

describe("Open VSX theme requests", () => {
  test("search encodes the query, restricts the category, and omits credentials", async () => {
    const result = await OpenVsxThemes.search(
      "night & day",
      signal(),
      async (url, init) => {
        expect(new URL(url).searchParams.get("query")).toBe("night & day");
        expect(new URL(url).searchParams.get("category")).toBe("Themes");
        expect(init.credentials).toBe("omit");
        return Response.json({ extensions: [extension] });
      },
    );
    expect(result).toEqual({ ok: true, value: [extension] });
  });

  test("rejects untrusted download URLs and malformed search results", async () => {
    for (const value of [
      {},
      {
        extensions: [
          {
            ...extension,
            files: { download: "https://evil.example/theme.vsix" },
          },
        ],
      },
      {
        extensions: [
          {
            ...extension,
            files: {
              download: "https://user:password@open-vsx.org/api/theme.vsix",
            },
          },
        ],
      },
    ]) {
      const result = await OpenVsxThemes.search("night", signal(), async () =>
        Response.json(value),
      );
      expect(result.ok).toBe(false);
    }
  });

  test("caps streamed search responses and cancels the reader", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(512 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const result = await OpenVsxThemes.search(
      "night",
      signal(),
      async () => new Response(body),
    );
    expect(result.ok).toBe(false);
    expect(cancelled).toBe(true);
  });

  test("reports HTTP and transport failures without installing anything", async () => {
    const unavailable = await OpenVsxThemes.search(
      "night",
      signal(),
      async () => new Response(null, { status: 503 }),
    );
    expect(unavailable.ok).toBe(false);
    const cancelled = new AbortController();
    cancelled.abort();
    const result = await OpenVsxThemes.search(
      "night",
      cancelled.signal,
      async () => {
        throw new DOMException("Cancelled", "AbortError");
      },
    );
    expect(result).toEqual({
      ok: false,
      error: "The theme request was cancelled.",
    });
  });

  test("installs contributed palettes without executing extension code", async () => {
    const bytes = zipSync({
      "extension/package.json": strToU8(
        JSON.stringify({
          main: "./code.js",
          contributes: {
            themes: [
              { label: "Night", path: "./night.json", uiTheme: "vs-dark" },
            ],
          },
        }),
      ),
      "extension/night.json": strToU8(
        '{"colors":{"editor.background":"#123456"}}',
      ),
      "extension/code.js": strToU8('throw new Error("Do not run");'),
    });
    const result = await OpenVsxThemes.install(
      extension,
      signal(),
      async () => new Response(bytes),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.colors.background).toBe("#123456");
  });
});
