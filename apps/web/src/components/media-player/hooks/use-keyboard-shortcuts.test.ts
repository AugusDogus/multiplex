import { describe, expect, test } from "bun:test";

import { shouldHandleMediaShortcut } from "./use-keyboard-shortcuts";

describe("shouldHandleMediaShortcut", () => {
  test("handles Space when focus is not a native control", () => {
    expect(
      shouldHandleMediaShortcut({
        code: "Space",
        defaultPrevented: false,
        isEditableTarget: false,
        isNativeButton: false,
      }),
    ).toBe(true);
  });

  test("ignores Space on a focused play button", () => {
    expect(
      shouldHandleMediaShortcut({
        code: "Space",
        defaultPrevented: false,
        isEditableTarget: false,
        isNativeButton: true,
      }),
    ).toBe(false);
  });

  test("still handles K when a play button is focused", () => {
    expect(
      shouldHandleMediaShortcut({
        code: "KeyK",
        defaultPrevented: false,
        isEditableTarget: false,
        isNativeButton: true,
      }),
    ).toBe(true);
  });

  test("ignores already-handled keys", () => {
    expect(
      shouldHandleMediaShortcut({
        code: "Space",
        defaultPrevented: true,
        isEditableTarget: false,
        isNativeButton: false,
      }),
    ).toBe(false);
  });

  test("ignores keys while typing", () => {
    expect(
      shouldHandleMediaShortcut({
        code: "Space",
        defaultPrevented: false,
        isEditableTarget: true,
        isNativeButton: false,
      }),
    ).toBe(false);
  });
});
