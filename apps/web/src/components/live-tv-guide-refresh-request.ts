export type LiveTvGuideRefreshState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "error"; message: string };

type LiveTvGuideRefreshResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export async function requestLiveTvGuideRefresh(
  requestReload: () => Promise<{ message: string }>,
): Promise<LiveTvGuideRefreshResult> {
  try {
    const result = await requestReload();
    return { ok: true, message: result.message };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "The guide refresh could not be requested.",
    };
  }
}
