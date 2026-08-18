import { describe, expect, test } from "bun:test";

import {
  shouldConsumeVideoSurfaceActivationKey,
  shouldHandleMediaShortcutFor,
} from "./use-keyboard-shortcuts";

describe("shouldHandleMediaShortcutFor", () => {
  test("handles Space on an unfocused page", () => {
    expect(
      shouldHandleMediaShortcutFor({
        code: "Space",
        defaultPrevented: false,
        targetKind: "other",
      }),
    ).toBe(true);
  });

  test("ignores Space on a focused play button", () => {
    expect(
      shouldHandleMediaShortcutFor({
        code: "Space",
        defaultPrevented: false,
        targetKind: "button",
      }),
    ).toBe(false);
  });

  test("still handles K when a play button is focused", () => {
    expect(
      shouldHandleMediaShortcutFor({
        code: "KeyK",
        defaultPrevented: false,
        targetKind: "button",
      }),
    ).toBe(true);
  });

  test("ignores already-handled keys", () => {
    expect(
      shouldHandleMediaShortcutFor({
        code: "Space",
        defaultPrevented: true,
        targetKind: "other",
      }),
    ).toBe(false);
  });

  test("ignores keys while typing", () => {
    expect(
      shouldHandleMediaShortcutFor({
        code: "Space",
        defaultPrevented: false,
        targetKind: "input",
      }),
    ).toBe(false);
    expect(
      shouldHandleMediaShortcutFor({
        code: "Space",
        defaultPrevented: false,
        targetKind: "textarea",
      }),
    ).toBe(false);
    expect(
      shouldHandleMediaShortcutFor({
        code: "Space",
        defaultPrevented: false,
        targetKind: "editable",
      }),
    ).toBe(false);
  });
});

describe("shouldConsumeVideoSurfaceActivationKey", () => {
  test("consumes Space on the desktop video surface after hold-to-2x", () => {
    expect(
      shouldConsumeVideoSurfaceActivationKey({
        key: " ",
        hasClickHandler: true,
      }),
    ).toBe(true);
  });

  test("leaves Space to the document shortcut on mobile", () => {
    expect(
      shouldConsumeVideoSurfaceActivationKey({
        key: " ",
        hasClickHandler: false,
      }),
    ).toBe(false);
  });
});
