import { describe, expect, test } from "bun:test";

import { isDocumentNavigation } from "./document-request";

function request(
  method: string,
  headers: Record<string, string>,
): { method: string; headers: { get(name: string): string | null } } {
  return {
    method,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
  };
}

describe("isDocumentNavigation", () => {
  test("treats sec-fetch-dest: document as a document navigation", () => {
    expect(
      isDocumentNavigation(
        request("GET", { "sec-fetch-dest": "document", accept: "*/*" }),
      ),
    ).toBe(true);
  });

  test("ignores non-document fetch destinations", () => {
    expect(
      isDocumentNavigation(
        request("GET", { "sec-fetch-dest": "empty", accept: "text/html" }),
      ),
    ).toBe(false);
    expect(
      isDocumentNavigation(
        request("GET", {
          "sec-fetch-dest": "script",
          accept: "application/javascript",
        }),
      ),
    ).toBe(false);
  });

  test("falls back to Accept: text/html when sec-fetch-dest is absent", () => {
    expect(
      isDocumentNavigation(
        request("GET", { accept: "text/html,application/xhtml+xml" }),
      ),
    ).toBe(true);
    expect(
      isDocumentNavigation(request("GET", { accept: "application/json" })),
    ).toBe(false);
  });

  test("rejects non-GET/HEAD methods", () => {
    expect(
      isDocumentNavigation(
        request("POST", { "sec-fetch-dest": "document", accept: "text/html" }),
      ),
    ).toBe(false);
  });
});
