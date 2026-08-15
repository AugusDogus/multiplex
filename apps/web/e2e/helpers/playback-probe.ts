import { type Page } from "@playwright/test";

import { sanitizeArtifactUrl } from "./watch-together-artifacts";

export interface PlaybackProbeSample {
  readonly at: number;
  readonly currentTimeSeconds: number;
  readonly durationSeconds: number;
  readonly streamOffsetSeconds: number;
  readonly timelinePositionSeconds: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly readyState: number;
  readonly networkState: number;
  readonly currentSrc: string;
  readonly error: { readonly code: number; readonly message: string } | null;
}

export async function readPlaybackProbe(
  page: Page,
): Promise<PlaybackProbeSample> {
  const sample = await page
    .locator("video")
    .evaluate((video: HTMLVideoElement) => {
      const offsetMatch = /[?&]offset=(\d+(?:\.\d+)?)/.exec(video.currentSrc);
      const streamOffsetSeconds = offsetMatch ? Number(offsetMatch[1]) : 0;
      return {
        at: Date.now(),
        currentTimeSeconds: video.currentTime,
        durationSeconds: video.duration,
        streamOffsetSeconds,
        timelinePositionSeconds: streamOffsetSeconds + video.currentTime,
        paused: video.paused,
        ended: video.ended,
        readyState: video.readyState,
        networkState: video.networkState,
        currentSrc: video.currentSrc,
        error: video.error
          ? { code: video.error.code, message: video.error.message }
          : null,
      };
    });
  return { ...sample, currentSrc: sanitizeArtifactUrl(sample.currentSrc) };
}

/**
 * Observes playback without correcting it. A paused, stalled, errored, or
 * detached player remains a functional failure instead of being nudged green.
 */
export async function waitForPlaybackAdvance(
  page: Page,
  options: {
    readonly label: string;
    readonly timeoutMs?: number;
    readonly minimumAdvanceSeconds?: number;
  },
): Promise<ReadonlyArray<PlaybackProbeSample>> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const minimumAdvanceSeconds = options.minimumAdvanceSeconds ?? 0.5;
  const deadline = Date.now() + timeoutMs;
  const samples: PlaybackProbeSample[] = [await readPlaybackProbe(page)];
  const initialPosition = samples[0]?.timelinePositionSeconds ?? 0;

  while (Date.now() < deadline) {
    await page.waitForTimeout(1_000);
    const sample = await readPlaybackProbe(page);
    samples.push(sample);

    if (sample.error) {
      throw new Error(
        `${options.label}: video failed while waiting for playback. samples=${JSON.stringify(samples.slice(-20))}`,
      );
    }
    if (
      !sample.paused &&
      !sample.ended &&
      sample.timelinePositionSeconds > initialPosition + minimumAdvanceSeconds
    ) {
      return samples;
    }
  }

  throw new Error(
    `${options.label}: video never advanced without intervention. samples=${JSON.stringify(samples.slice(-20))}`,
  );
}
