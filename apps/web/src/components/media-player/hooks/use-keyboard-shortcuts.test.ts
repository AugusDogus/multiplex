import { describe, expect, test } from "bun:test";

import {
  isSpaceActivatingControl,
  shouldHandleMediaShortcut,
} from "./use-keyboard-shortcuts";

function shortcutEvent({
  code,
  target,
  defaultPrevented = false,
}: {
  code: string;
  target?: EventTarget | null;
  defaultPrevented?: boolean;
}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    code,
    cancelable: true,
  });
  Object.defineProperty(event, "target", { value: target ?? document.body });
  if (defaultPrevented) {
    event.preventDefault();
  }
  return event;
}

describe("isSpaceActivatingControl", () => {
  test("treats native buttons as Space-activated", () => {
    expect(isSpaceActivatingControl(document.createElement("button"))).toBe(
      true,
    );
  });

  test("treats role=button surfaces as Space-activated", () => {
    const surface = document.createElement("div");
    surface.setAttribute("role", "button");
    expect(isSpaceActivatingControl(surface)).toBe(true);
  });

  test("ignores ordinary elements", () => {
    expect(isSpaceActivatingControl(document.createElement("div"))).toBe(false);
    expect(isSpaceActivatingControl(null)).toBe(false);
  });
});

describe("shouldHandleMediaShortcut", () => {
  test("handles Space on the document body", () => {
    expect(
      shouldHandleMediaShortcut(shortcutEvent({ code: "Space" })),
    ).toBe(true);
  });

  test("ignores Space after the video surface already handled it", () => {
    const surface = document.createElement("div");
    surface.setAttribute("role", "button");
    expect(
      shouldHandleMediaShortcut(
        shortcutEvent({ code: "Space", target: surface }),
      ),
    ).toBe(false);
  });

  test("still handles K when the video surface is focused", () => {
    const surface = document.createElement("div");
    surface.setAttribute("role", "button");
    expect(
      shouldHandleMediaShortcut(
        shortcutEvent({ code: "KeyK", target: surface }),
      ),
    ).toBe(true);
  });

  test("ignores Space on a focused play button", () => {
    expect(
      shouldHandleMediaShortcut(
        shortcutEvent({
          code: "Space",
          target: document.createElement("button"),
        }),
      ),
    ).toBe(false);
  });

  test("ignores already-handled keys", () => {
    expect(
      shouldHandleMediaShortcut(
        shortcutEvent({ code: "Space", defaultPrevented: true }),
      ),
    ).toBe(false);
  });

  test("ignores keys while typing", () => {
    expect(
      shouldHandleMediaShortcut(
        shortcutEvent({
          code: "Space",
          target: document.createElement("input"),
        }),
      ),
    ).toBe(false);
    expect(
      shouldHandleMediaShortcut(
        shortcutEvent({
          code: "Space",
          target: document.createElement("textarea"),
        }),
      ),
    ).toBe(false);

    const editable = document.createElement("div");
    editable.contentEditable = "true";
    expect(
      shouldHandleMediaShortcut(
        shortcutEvent({ code: "Space", target: editable }),
      ),
    ).toBe(false);
  });
});
