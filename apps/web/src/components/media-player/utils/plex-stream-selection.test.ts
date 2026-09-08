import { expect, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import type { ItemMetadata } from "@multiplex/plex-query";

import { applySelectedStream } from "./plex-stream-selection";

const item = fromPartial<ItemMetadata>({
  ratingKey: "42",
  key: "/library/metadata/42",
  title: "Episode",
  type: "episode",
  Media: [
    {
      Part: [
        {
          Stream: [
            { id: 1, streamType: 1, codec: "h264", index: 0 },
            { id: 2, streamType: 2, codec: "aac", index: 1, selected: true },
            { id: 3, streamType: 2, codec: "aac", index: 2 },
            { id: 4, streamType: 3, codec: "pgs", index: 3 },
            { id: 5, streamType: 3, codec: "srt", index: 4, selected: true },
          ],
        },
      ],
    },
  ],
});

test("applies a guest subtitle selection without changing other streams", () => {
  const selected = applySelectedStream(item, "subtitle", 4);
  const streams = selected.Media?.[0]?.Part?.[0]?.Stream;

  expect(
    streams?.map((stream) => [
      stream.id,
      stream.streamType === 1 ? undefined : stream.selected,
    ]),
  ).toEqual([
    [1, undefined],
    [2, true],
    [3, undefined],
    [4, true],
    [5, false],
  ]);
});

test("clears every subtitle selection when subtitles are disabled", () => {
  const selected = applySelectedStream(item, "subtitle", null);
  const subtitles = selected.Media?.[0]?.Part?.[0]?.Stream?.filter(
    (stream) => stream.streamType === 3,
  );

  expect(subtitles?.map((stream) => stream.selected)).toEqual([false, false]);
});
