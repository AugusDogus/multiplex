import { describe, expect, mock, test } from "bun:test";

import {
  createLiveTvGuideRefreshController,
  GUIDE_REFRESH_DELAY_MS,
} from "./live-tv-guide-refresh";

function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { callback: () => void; runAt: number }>();

  return {
    schedule: (callback: () => void, delayMs: number) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, runAt: now + delayMs });
      return id;
    },
    cancel: (timer: number) => {
      timers.delete(timer);
    },
    advanceBy: (delayMs: number) => {
      now += delayMs;
      const ready = [...timers.entries()]
        .filter(([, timer]) => timer.runAt <= now)
        .sort((left, right) => left[1].runAt - right[1].runAt);
      for (const [id, timer] of ready) {
        timers.delete(id);
        timer.callback();
      }
    },
  };
}

describe("Live TV guide refresh controller", () => {
  test("suppresses duplicate requests and refreshes after the bounded delay", async () => {
    const timers = createFakeTimers();
    const requestReload = mock().mockResolvedValue({
      message: "Guide refresh requested.",
    });
    const refresh = mock();
    const controller = createLiveTvGuideRefreshController({
      requestReload,
      refresh,
      schedule: timers.schedule,
      cancel: timers.cancel,
    });

    await Promise.all([controller.request(), controller.request()]);

    expect(requestReload).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toEqual({
      status: "scheduled",
      message: "Guide refresh requested.",
    });
    timers.advanceBy(GUIDE_REFRESH_DELAY_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    timers.advanceBy(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toEqual({ status: "idle" });
  });

  test("exposes an error and permits a later retry", async () => {
    const timers = createFakeTimers();
    const requestReload = mock()
      .mockRejectedValueOnce(new Error("Plex rejected the refresh."))
      .mockResolvedValueOnce({ message: "Guide refresh requested." });
    const controller = createLiveTvGuideRefreshController({
      requestReload,
      refresh: mock(),
      schedule: timers.schedule,
      cancel: timers.cancel,
    });

    await controller.request();
    expect(controller.getSnapshot()).toEqual({
      status: "error",
      message: "Plex rejected the refresh.",
    });

    await controller.request();
    expect(requestReload).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toEqual({
      status: "scheduled",
      message: "Guide refresh requested.",
    });
  });

  test("cancels a scheduled refresh when disposed", async () => {
    const timers = createFakeTimers();
    const refresh = mock();
    const controller = createLiveTvGuideRefreshController({
      requestReload: mock().mockResolvedValue({
        message: "Guide refresh requested.",
      }),
      refresh,
      schedule: timers.schedule,
      cancel: timers.cancel,
    });

    await controller.request();
    controller.dispose();
    timers.advanceBy(GUIDE_REFRESH_DELAY_MS);

    expect(refresh).not.toHaveBeenCalled();
  });
});
