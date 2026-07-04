import { describe, expect, test } from "bun:test";

import { getLobbyHint } from "./watch-together-lobby";

const base = {
  everyonePresent: false,
  everyonePresentNow: false,
  canStart: false,
  autoStartSuppressed: false,
  someoneElseWatching: false,
};

describe("getLobbyHint", () => {
  test("promises playback only when auto-start will actually fire", () => {
    expect(
      getLobbyHint({
        ...base,
        everyonePresent: true,
        everyonePresentNow: true,
        canStart: true,
      }),
    ).toBe("Everyone's here — starting playback…");
  });

  test("a suppressed viewer alone in the room is told to press Start, not lied to", () => {
    // The reported bug: after the other member ended the session this viewer is
    // alone (everyone present) but auto-start is suppressed from an earlier
    // leave — it must NOT claim playback is starting.
    const hint = getLobbyHint({
      ...base,
      everyonePresent: true,
      everyonePresentNow: true,
      canStart: true,
      autoStartSuppressed: true,
    });
    expect(hint).toBe("Press Start when you're ready to watch.");
    expect(hint).not.toContain("starting playback");
  });

  test("someone else already watching invites a suppressed viewer to join", () => {
    // When this viewer won't auto-start (suppressed) but another member is
    // already watching, point them at Start to join rather than a generic hint.
    expect(
      getLobbyHint({
        ...base,
        everyonePresent: true,
        everyonePresentNow: true,
        canStart: true,
        autoStartSuppressed: true,
        someoneElseWatching: true,
      }),
    ).toBe("Someone already started watching — press Start to join.");
  });

  test("everyone present but media still loading shows a preparing state", () => {
    expect(
      getLobbyHint({
        ...base,
        everyonePresent: true,
        everyonePresentNow: true,
      }),
    ).toBe("Getting the stream ready…");
  });

  test("never tells the user to press Start while it is disabled (media not ready)", () => {
    // Suppressed + everyone present + someone watching, but canStart is false:
    // the Start button is disabled, so the hint must not say "press Start".
    const hint = getLobbyHint({
      ...base,
      everyonePresent: true,
      everyonePresentNow: true,
      autoStartSuppressed: true,
      someoneElseWatching: true,
      canStart: false,
    });
    expect(hint).toBe("Getting the stream ready…");
    expect(hint).not.toContain("Start");
  });

  test("waits for missing invitees", () => {
    expect(getLobbyHint(base)).toBe("Waiting for everyone to join…");
  });
});
