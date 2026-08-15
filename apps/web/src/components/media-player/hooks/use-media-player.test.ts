import { describe, expect, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";

import type { MediaPlayerItem } from "~/types/media-player";
import {
  detachMediaForReplacement,
  getMediaSeekResult,
  getMediaToggleAction,
} from "./use-media-player";

type MediaEntry = NonNullable<MediaPlayerItem["Media"]>[number];

const item = fromPartial<MediaPlayerItem>({
  ratingKey: "100",
  key: "/library/metadata/100",
  title: "Test Episode",
  type: "episode",
  hubTitle: "TV Shows",
  hubType: "metadata",
  serverId: "server-1",
  serverUrl: "https://plex.example",
  authToken: "token",
});

describe("getMediaSeekResult", () => {
  test("reloads a Plex transcode without consulting the video element source", () => {
    const transcodedItem = {
      ...item,
      Media: [
        fromPartial<MediaEntry>({
          audioCodec: "eac3",
          videoCodec: "h264",
          container: "mkv",
        }),
      ],
    };

    expect(getMediaSeekResult(transcodedItem)).toBe("reload");
  });

  test("uses a native seek for direct-play media", () => {
    const directPlayItem = {
      ...item,
      Media: [
        fromPartial<MediaEntry>({
          audioCodec: "aac",
          videoCodec: "h264",
          container: "mp4",
        }),
      ],
    };

    expect(getMediaSeekResult(directPlayItem)).toBe("direct");
  });
});

test("detaches an old media source before transcode cleanup", () => {
  const calls: string[] = [];
  const video = {
    pause: () => calls.push("pause"),
    removeAttribute: (name: string) => calls.push(`remove:${name}`),
    load: () => calls.push("load"),
  };

  detachMediaForReplacement(video);

  expect(calls).toEqual(["pause", "remove:src", "load"]);
});

test("toggles from the media element instead of stale transport state", () => {
  expect(getMediaToggleAction({ paused: true }, true)).toBe("play");
  expect(getMediaToggleAction({ paused: false }, false)).toBe("pause");
  expect(getMediaToggleAction(null, true)).toBe("pause");
});
