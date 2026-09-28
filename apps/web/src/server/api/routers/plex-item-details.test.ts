import { beforeEach, expect, mock, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import { TRPCError } from "@trpc/server";
import type {
  ItemMetadata,
  ItemMetadataChild,
  PlexServerClient,
  PlexTvClient,
} from "@multiplex/plex-query";
import {
  SERVER,
  getServersQuery,
  makeCaller,
} from "./plex-router-test-harness";

const show: ItemMetadata = {
  ratingKey: "100",
  key: "/library/metadata/100/children",
  guid: "plex://show/100",
  type: "show",
  title: "Unstarted show",
  librarySectionTitle: "TV",
  librarySectionID: 1,
  librarySectionKey: "/library/sections/1",
};

const season: ItemMetadataChild = {
  ratingKey: "101",
  key: "/library/metadata/101/children",
  guid: "plex://season/101",
  type: "season",
  title: "Season 1",
  index: 1,
};

const episode: ItemMetadataChild = {
  ratingKey: "102",
  key: "/library/metadata/102",
  guid: "plex://episode/102",
  type: "episode",
  title: "Pilot",
  index: 1,
  parentIndex: 1,
  Media: [
    {
      id: 1,
      duration: 1_800_000,
      bitrate: 1000,
      width: 1920,
      height: 1080,
      aspectRatio: 1.78,
      audioChannels: 2,
      audioCodec: "aac",
      videoCodec: "h264",
      videoResolution: "1080",
      container: "mp4",
      videoFrameRate: "24p",
      Part: [
        {
          id: 1,
          key: "/library/parts/1/file.mp4",
          duration: 1_800_000,
          file: "/tv/pilot.mp4",
          size: 1000,
          container: "mp4",
        },
      ],
    },
  ],
};

beforeEach(() => {
  getServersQuery.mockReset();
  getServersQuery.mockResolvedValue([SERVER]);
});

function itemDetailsCaller(
  item: ItemMetadata,
  children: ReadonlyMap<string, ItemMetadataChild[]>,
) {
  const getMetadataChildren = mock(async (ratingKey: string) => {
    return children.get(ratingKey) ?? [];
  });
  const serverClient = fromPartial<PlexServerClient>({
    getItemMetadata: async () => item,
    getMetadataChildren,
  });
  const plex = fromPartial<PlexTvClient>({
    createServerClient: () => serverClient,
  });
  return { caller: makeCaller(plex), getMetadataChildren };
}

test("getItemDetails lets an unstarted show play its first episode", async () => {
  const { caller, getMetadataChildren } = itemDetailsCaller(
    show,
    new Map([
      [show.ratingKey, [season]],
      [season.ratingKey, [episode]],
    ]),
  );

  const result = await caller.getItemDetails({
    serverId: SERVER.clientIdentifier,
    ratingKey: show.ratingKey,
  });

  expect(result?.playTarget).toMatchObject({
    ratingKey: episode.ratingKey,
    streamPartKey: "/library/parts/1/file.mp4",
    librarySectionID: show.librarySectionID,
    librarySectionTitle: show.librarySectionTitle,
    librarySectionKey: show.librarySectionKey,
  });
  expect(result?.children.map((child) => child.ratingKey)).toEqual([
    season.ratingKey,
  ]);
  expect(getMetadataChildren.mock.calls).toEqual([["100"], ["101"]]);
});

const specials: ItemMetadataChild = {
  ...season,
  ratingKey: "200",
  title: "Specials",
  index: 0,
};
const laterSeason: ItemMetadataChild = {
  ...season,
  ratingKey: "300",
  title: "Season 2",
  index: 2,
};
const specialEpisode: ItemMetadataChild = {
  ...episode,
  ratingKey: "201",
  parentIndex: 0,
};

test.each([
  {
    name: "prefers the earliest regular season over specials",
    seasons: [specials, laterSeason, season],
    episodes: [episode],
    expected: episode.ratingKey,
    calls: [["100"], ["101"]],
  },
  {
    name: "skips an empty season",
    seasons: [season, laterSeason],
    episodes: [],
    expected: "301",
    calls: [["100"], ["101"], ["300"]],
  },
  {
    name: "skips episodes without playable media",
    seasons: [season],
    episodes: [{ ...episode, ratingKey: "unavailable", Media: [] }, episode],
    expected: episode.ratingKey,
    calls: [["100"], ["101"]],
  },
  {
    name: "can play a show with only specials",
    seasons: [specials],
    episodes: [],
    expected: specialEpisode.ratingKey,
    calls: [["100"], ["200"]],
  },
  {
    name: "leaves shows without playable episodes disabled",
    seasons: [season],
    episodes: [],
    expected: undefined,
    calls: [["100"], ["101"]],
  },
  {
    name: "leaves shows without seasons disabled",
    seasons: [],
    episodes: [],
    expected: undefined,
    calls: [["100"]],
  },
])("getItemDetails $name", async ({ seasons, episodes, expected, calls }) => {
  const { caller, getMetadataChildren } = itemDetailsCaller(
    show,
    new Map([
      [show.ratingKey, seasons],
      [season.ratingKey, episodes],
      [specials.ratingKey, [specialEpisode]],
      [
        laterSeason.ratingKey,
        [{ ...episode, ratingKey: "301", parentIndex: 2 }],
      ],
    ]),
  );

  const result = await caller.getItemDetails({
    serverId: SERVER.clientIdentifier,
    ratingKey: show.ratingKey,
  });

  expect<string | undefined>(result?.playTarget?.ratingKey).toBe(expected);
  expect<string[][]>(getMetadataChildren.mock.calls).toEqual(calls);
  expect(result?.children.map((child) => child.ratingKey)).toEqual(
    seasons.map((child) => child.ratingKey),
  );
});

test.each(["movie", "episode", "season"])(
  "getItemDetails preserves %s playback",
  async (type) => {
    const item: ItemMetadata = {
      ...show,
      ...(type === "season" ? season : episode),
      type,
    };
    const { caller, getMetadataChildren } = itemDetailsCaller(
      item,
      new Map([[item.ratingKey, [episode]]]),
    );

    const result = await caller.getItemDetails({
      serverId: SERVER.clientIdentifier,
      ratingKey: item.ratingKey,
    });

    expect(result?.playTarget?.ratingKey).toBe(episode.ratingKey);
    expect(getMetadataChildren.mock.calls).toEqual(
      type === "season" ? [[item.ratingKey]] : [],
    );
  },
);

test("getItemDetails loads fallback seasons concurrently but selects in season order", async () => {
  const { caller, getMetadataChildren } = itemDetailsCaller(show, new Map());
  let callsAtFallbackCompletion: string[] = [];
  getMetadataChildren.mockImplementation(async (ratingKey) => {
    if (ratingKey === show.ratingKey) return [specials, laterSeason, season];
    if (ratingKey === laterSeason.ratingKey) {
      // Yield once so a concurrent specials request can finish first.
      await Promise.resolve();
      callsAtFallbackCompletion = getMetadataChildren.mock.calls.map(
        ([key]) => key,
      );
      return [{ ...episode, ratingKey: "301", parentIndex: 2 }];
    }
    if (ratingKey === specials.ratingKey) return [specialEpisode];
    return [];
  });

  const result = await caller.getItemDetails({
    serverId: SERVER.clientIdentifier,
    ratingKey: show.ratingKey,
  });

  expect(result?.playTarget?.ratingKey).toBe("301");
  expect(callsAtFallbackCompletion).toEqual([
    show.ratingKey,
    season.ratingKey,
    laterSeason.ratingKey,
    specials.ratingKey,
  ]);
});

test("getItemDetails keeps an earlier play target when a later season fails", async () => {
  const { caller, getMetadataChildren } = itemDetailsCaller(show, new Map());
  getMetadataChildren
    .mockResolvedValueOnce([season, laterSeason, specials])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ ...episode, ratingKey: "301", parentIndex: 2 }])
    .mockRejectedValueOnce(new TRPCError({ code: "SERVICE_UNAVAILABLE" }));

  const result = await caller.getItemDetails({
    serverId: SERVER.clientIdentifier,
    ratingKey: show.ratingKey,
  });

  expect(result?.playTarget?.ratingKey).toBe("301");
});

test("getItemDetails preserves details and reports an earlier season failure", async () => {
  const failure = new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const { caller, getMetadataChildren } = itemDetailsCaller(show, new Map());
  getMetadataChildren
    .mockResolvedValueOnce([season, laterSeason, specials])
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce([specialEpisode]);

  const result = await caller.getItemDetails({
    serverId: SERVER.clientIdentifier,
    ratingKey: show.ratingKey,
  });

  expect(result?.item).toEqual(show);
  expect(result?.children).toHaveLength(3);
  expect(result?.playTarget).toBeNull();
  expect(result).toHaveProperty(
    "playTargetError.code",
    "EPISODE_LOOKUP_FAILED",
  );
});

test("getItemDetails preserves show browsing when the first season fails", async () => {
  const { caller, getMetadataChildren } = itemDetailsCaller(show, new Map());
  getMetadataChildren
    .mockResolvedValueOnce([season, laterSeason])
    .mockRejectedValueOnce(new TRPCError({ code: "SERVICE_UNAVAILABLE" }));

  const result = await caller.getItemDetails({
    serverId: SERVER.clientIdentifier,
    ratingKey: show.ratingKey,
  });

  expect(result?.item).toEqual(show);
  expect(result?.children.map((child) => child.ratingKey)).toEqual([
    "101",
    "300",
  ]);
  expect(result?.playTarget).toBeNull();
  expect(result).toHaveProperty(
    "playTargetError.code",
    "EPISODE_LOOKUP_FAILED",
  );
});

test("getItemDetails returns an earlier target without waiting for a later season", async () => {
  const { caller, getMetadataChildren } = itemDetailsCaller(show, new Map());
  getMetadataChildren
    .mockResolvedValueOnce([season, laterSeason, specials])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ ...episode, ratingKey: "301", parentIndex: 2 }])
    .mockImplementationOnce(
      () => new Promise<ItemMetadataChild[]>(() => undefined),
    );

  const result = await caller.getItemDetails({
    serverId: SERVER.clientIdentifier,
    ratingKey: show.ratingKey,
  });

  expect(result?.playTarget?.ratingKey).toBe("301");
});
