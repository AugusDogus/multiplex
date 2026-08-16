import { expect, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";

import type { MediaPlayerItem } from "~/types/media-player";
import {
  buildPlexPlaybackPlan,
  decideStreamMode,
  getSelectedAudioStreamId,
  resolveSelectedAudioStream,
} from "./plex-playback-plan";

type MediaEntry = NonNullable<MediaPlayerItem["Media"]>[number];

const frenchAudio = {
  id: 10,
  streamType: 2 as const,
  codec: "aac",
  language: "French",
  displayTitle: "French",
  default: true,
};

const englishAudio = {
  id: 11,
  streamType: 2 as const,
  codec: "aac",
  language: "English",
  displayTitle: "English",
  selected: true,
};

const directPlayItem = fromPartial<MediaPlayerItem>({
  ratingKey: "378571",
  key: "/library/metadata/378571",
  serverId: "server-1",
  serverUrl: "https://plex.example",
  authToken: "token",
  Media: [
    fromPartial<MediaEntry>({
      audioCodec: "aac",
      videoCodec: "h264",
      container: "mp4",
      Part: [
        {
          Stream: [
            { id: 1, streamType: 1 as const, codec: "h264" },
            frenchAudio,
            englishAudio,
          ],
        },
      ],
    }),
  ],
});

test("prefers the selected audio stream over the container default", () => {
  const streams = [frenchAudio, englishAudio];

  expect(resolveSelectedAudioStream(streams)?.id).toBe(11);
  expect(getSelectedAudioStreamId(directPlayItem)).toBe(11);
});

test("falls back to the default audio stream when none is selected", () => {
  const streams = [frenchAudio, { ...englishAudio, selected: undefined }];

  expect(resolveSelectedAudioStream(streams)?.id).toBe(10);
});

test("remuxes when the selected audio is not the first container track", () => {
  expect(decideStreamMode(directPlayItem)).toBe("direct-stream");
  expect(buildPlexPlaybackPlan(directPlayItem)).toMatchObject({
    streamDecision: "direct-stream",
    videoUsesTranscode: true,
    selectedAudioStreamId: 11,
  });
});

test("direct-plays a single browser-decodable audio track", () => {
  const item = fromPartial<MediaPlayerItem>({
    ...directPlayItem,
    Media: [
      fromPartial<MediaEntry>({
        audioCodec: "aac",
        videoCodec: "h264",
        container: "mp4",
        Part: [
          {
            Stream: [
              { id: 1, streamType: 1 as const, codec: "h264" },
              { ...englishAudio, selected: true },
            ],
          },
        ],
      }),
    ],
  });

  expect(decideStreamMode(item)).toBe("direct-play");
  expect(buildPlexPlaybackPlan(item).selectedAudioStreamId).toBe(11);
});

test("uses the selected audio codec when deciding whether to remux", () => {
  const item = fromPartial<MediaPlayerItem>({
    ...directPlayItem,
    Media: [
      fromPartial<MediaEntry>({
        audioCodec: "aac",
        videoCodec: "h264",
        container: "mp4",
        Part: [
          {
            Stream: [
              { id: 1, streamType: 1 as const, codec: "h264" },
              { ...englishAudio, codec: "eac3", selected: true },
            ],
          },
        ],
      }),
    ],
  });

  expect(decideStreamMode(item)).toBe("direct-stream");
});
