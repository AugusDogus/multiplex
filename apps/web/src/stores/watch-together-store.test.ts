import { beforeEach, expect, test } from "vitest";

import { useWatchTogetherStore } from "./watch-together-store";

const user = {
  id: 42,
  deviceIdentifier: "device-42",
  deviceName: "Test Device",
};

beforeEach(() => {
  useWatchTogetherStore.setState({ session: null, participants: {} });
});

test("clears readiness when a watching participant leaves", () => {
  const { updateParticipant } = useWatchTogetherStore.getState();

  // Present and watching.
  updateParticipant({ user, isPresent: true, isReady: true });
  expect(
    useWatchTogetherStore.getState().participants[user.deviceIdentifier],
  ).toMatchObject({ isPresent: true, isReady: true });

  // A leave event only carries `isPresent: false`; the stale `isReady: true`
  // must not survive, or they'd keep showing as "watching" after disconnecting.
  updateParticipant({ user, isPresent: false });

  const left =
    useWatchTogetherStore.getState().participants[user.deviceIdentifier];
  expect(left?.isPresent).toBe(false);
  expect(left?.isReady).toBeFalsy();
});

test("preserves known presence when a partial update omits it", () => {
  const { updateParticipant } = useWatchTogetherStore.getState();

  // Learned from the room list that they're present.
  updateParticipant({ user, isPresent: true });
  // A readiness-only Set update (presence omitted) must not flip them to absent.
  updateParticipant({ user, isReady: true });

  const merged =
    useWatchTogetherStore.getState().participants[user.deviceIdentifier];
  expect(merged?.isPresent).toBe(true);
  expect(merged?.isReady).toBe(true);
});
