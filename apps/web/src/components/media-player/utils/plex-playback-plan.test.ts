import { expect, test } from "bun:test";

import type { MediaPlayerItem } from "~/types/media-player";
import { buildPlexPlaybackPlan } from "./plex-playback-plan";

type StreamOverride = {
  id: number;
  streamType: number;
  selected?: boolean;
  codec: string;
  index?: number;
  key?: string;
  format?: string;
};

function makeItem(overrides: {
  videoCodec?: string;
  audioCodec?: string;
  container?: string;
  streams?: StreamOverride[];
}): MediaPlayerItem {
  return {
    ratingKey: "1",
    key: "/library/metadata/1",
    serverId: "server-1",
    serverUrl: "https://plex.example",
    authToken: "token",
    Media: [
      {
        videoCodec: overrides.videoCodec ?? "h264",
        audioCodec: overrides.audioCodec ?? "eac3",
        container: overrides.container ?? "mkv",
        Part: [
          {
            key: "/library/parts/1/file.mkv",
            Stream: overrides.streams ?? [],
          },
        ],
      },
    ],
  } as unknown as MediaPlayerItem;
}

test("remux-eligible media uses client remux when allowed", () => {
  const plan = buildPlexPlaybackPlan(makeItem({}), { allowClientRemux: true });
  expect(plan.videoSource).toBe("client-remux");
  expect(plan.videoUsesTranscode).toBe(false);
  expect(plan.burnedSubtitleIndex).toBeNull();
});

test("remux-eligible media falls back to the Plex transcoder when disallowed", () => {
  const plan = buildPlexPlaybackPlan(makeItem({}), { allowClientRemux: false });
  expect(plan.videoSource).toBe("plex-transcode");
  expect(plan.videoUsesTranscode).toBe(true);
});

test("client remux requires supported codecs even when allowed", () => {
  const hevc = buildPlexPlaybackPlan(makeItem({ videoCodec: "hevc" }), {
    allowClientRemux: true,
  });
  expect(hevc.videoSource).toBe("plex-transcode");

  const dts = buildPlexPlaybackPlan(makeItem({ audioCodec: "dca" }), {
    allowClientRemux: true,
  });
  expect(dts.videoSource).toBe("plex-transcode");

  const avi = buildPlexPlaybackPlan(makeItem({ container: "avi" }), {
    allowClientRemux: true,
  });
  expect(avi.videoSource).toBe("plex-transcode");
});

test("direct-playable media stays on direct play, not client remux", () => {
  const plan = buildPlexPlaybackPlan(
    makeItem({ videoCodec: "h264", audioCodec: "aac", container: "mp4" }),
    { allowClientRemux: true },
  );
  expect(plan.videoSource).toBe("direct-play");
  expect(plan.videoUsesTranscode).toBe(false);
});

test("client remux keeps sidecar text subtitles client-side", () => {
  const plan = buildPlexPlaybackPlan(
    makeItem({
      streams: [
        {
          id: 7,
          streamType: 3,
          selected: true,
          codec: "srt",
          index: 3,
          key: "/library/streams/7",
          format: "srt",
        },
      ],
    }),
    { allowClientRemux: true },
  );
  expect(plan.videoSource).toBe("client-remux");
  expect(plan.subtitle).toEqual({
    kind: "externalText",
    key: "/library/streams/7",
  });
  expect(plan.burnedSubtitleIndex).toBeNull();
});

test("image subtitles force the Plex burn-in path over client remux", () => {
  const plan = buildPlexPlaybackPlan(
    makeItem({
      streams: [
        { id: 9, streamType: 3, selected: true, codec: "pgs", index: 4 },
      ],
    }),
    { allowClientRemux: true },
  );
  expect(plan.videoSource).toBe("plex-transcode");
  expect(plan.subtitle).toEqual({ kind: "burnIn", index: 4 });
  expect(plan.burnedSubtitleIndex).toBe(4);
  expect(plan.videoUsesTranscode).toBe(true);
});
