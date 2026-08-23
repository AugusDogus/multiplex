import { describe, expect, test } from "bun:test";

import {
  getQueueActionDisabledReason,
  type QueueActionContext,
} from "./media-item-actions";

const compatibleQueue: QueueActionContext = {
  targetType: "video",
  activeType: "video",
  hasActiveQueue: true,
  isSameServer: true,
  hasServerConnection: true,
  isPending: false,
};

describe("getQueueActionDisabledReason", () => {
  test("allows matching media in the active queue", () => {
    expect(getQueueActionDisabledReason(compatibleQueue)).toBeUndefined();
  });

  test("rejects cross-media queue updates", () => {
    expect(
      getQueueActionDisabledReason({
        ...compatibleQueue,
        targetType: "audio",
      }),
    ).toBe("This item does not match the active playback queue's media type.");
  });

  test("rejects photo queues before checking compatibility", () => {
    expect(
      getQueueActionDisabledReason({
        ...compatibleQueue,
        targetType: "photo",
        activeType: "photo",
      }),
    ).toBe("Photo items cannot be added to the active playback queue.");
  });

  test("requires an active same-server queue and connection", () => {
    expect(
      getQueueActionDisabledReason({
        ...compatibleQueue,
        hasActiveQueue: false,
      }),
    ).toBe("Start playback first to add items to the active queue.");
    expect(
      getQueueActionDisabledReason({
        ...compatibleQueue,
        isSameServer: false,
      }),
    ).toBe("Start playback first to add items to the active queue.");
    expect(
      getQueueActionDisabledReason({
        ...compatibleQueue,
        hasServerConnection: false,
      }),
    ).toBe("Start playback first to add items to the active queue.");
  });

  test("disables another update while one is pending", () => {
    expect(
      getQueueActionDisabledReason({
        ...compatibleQueue,
        isPending: true,
      }),
    ).toBe("Updating the active Plex queue.");
  });
});
