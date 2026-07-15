import { describe, expect, mock, test } from "bun:test";

import { requestLiveTvGuideRefresh } from "./live-tv-guide-refresh";

describe("requestLiveTvGuideRefresh", () => {
  test("returns the acknowledged message from Plex", async () => {
    const requestReload = mock().mockResolvedValue({
      message: "Guide refresh requested.",
    });

    const result = await requestLiveTvGuideRefresh(requestReload);

    expect(result).toEqual({
      ok: true,
      message: "Guide refresh requested.",
    });
    expect(requestReload).toHaveBeenCalledTimes(1);
  });

  test("returns a retryable error message", async () => {
    const result = await requestLiveTvGuideRefresh(
      mock().mockRejectedValue(new Error("Plex rejected the refresh.")),
    );

    expect(result).toEqual({
      ok: false,
      message: "Plex rejected the refresh.",
    });
  });

  test("does not expose unknown thrown values", async () => {
    const result = await requestLiveTvGuideRefresh(
      mock().mockRejectedValue({ private: "details" }),
    );

    expect(result).toEqual({
      ok: false,
      message: "The guide refresh could not be requested.",
    });
  });
});
