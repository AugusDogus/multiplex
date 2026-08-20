import { afterEach, describe, expect, test } from "bun:test";

import { getPlexConfig } from "./config";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function restoreGlobal(name: "window" | "localStorage", descriptor?: PropertyDescriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
    return;
  }

  Reflect.deleteProperty(globalThis, name);
}

afterEach(() => {
  restoreGlobal("window", originalWindow);
  restoreGlobal("localStorage", originalLocalStorage);
});

describe("getPlexConfig", () => {
  test("uses a server identifier when browser storage is unavailable", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: undefined,
    });

    expect(getPlexConfig().clientIdentifier).toBe("server-side");
  });
});
