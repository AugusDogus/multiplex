import { beforeEach, describe, expect, test } from "bun:test";
import type { ItemMetadata } from "@multiplex/plex-query";

import {
  createPlayerService,
  getPlayerPlaybackIdentity,
  isPlayerPlaybackIdentityCurrent,
  type PlayerServiceShape,
} from "./player-service";
import {
  partializePlayerPrefs,
  prefsFromPersisted,
  usePlayerPrefsStore,
  type PlayerPrefsState,
} from "~/stores/player-prefs-store";
import {
  getProgressIdentityKey,
  useProgressStore,
} from "~/stores/progress-store";
import type { MediaPlayerItem, NextEpisodeInfo } from "~/types/media-player";

const directPlayMedia = {
  audioCodec: "aac",
  videoCodec: "h264",
  container: "mp4",
  Part: [
    {
      Stream: [
        { id: 1, streamType: 1 as const, codec: "h264", selected: true },
        { id: 2, streamType: 2 as const, codec: "aac", selected: true },
      ],
    },
  ],
} as MediaPlayerItem["Media"] extends (infer M)[] | undefined ? M : never;

const sampleItem = {
  ratingKey: "100",
  key: "/library/metadata/100",
  title: "Test Episode",
  type: "episode",
  hubTitle: "TV Shows",
  hubType: "metadata",
  serverId: "server-1",
  serverUrl: "https://plex.example",
  authToken: "token",
  duration: 600_000,
} as MediaPlayerItem;

const nextEpisode: NextEpisodeInfo = {
  ratingKey: "101",
  key: "/library/metadata/101",
  title: "Next",
  index: 2,
  parentIndex: 1,
  duration: 500_000,
  grandparentTitle: "Show",
  parentTitle: "Season 1",
};

let player: PlayerServiceShape;

beforeEach(() => {
  player = createPlayerService();
  useProgressStore.getState().clearAllProgress();
  usePlayerPrefsStore.setState({
    volume: 1,
    isMuted: false,
    playbackRate: 1,
    captionSize: "medium",
    autoPlayEnabled: true,
  });
});

describe("openPlayer resume math", () => {
  test("resume === false starts at 0", () => {
    player.openPlayer(
      { ...sampleItem, viewOffset: 120_000 },
      { resume: false },
    );
    expect(player.snapshot().currentTime).toBe(0);
    expect(player.snapshot().streamOffset).toBe(0);
  });

  test("server-scoped progress path seeds currentTime", () => {
    useProgressStore
      .getState()
      .updateItemProgress({ serverId: "server-2", ratingKey: "100" }, 80);
    useProgressStore
      .getState()
      .updateItemProgress({ serverId: "server-1", ratingKey: "100" }, 50);
    player.openPlayer({ ...sampleItem, Media: [directPlayMedia] });
    expect(player.snapshot().currentTime).toBe(300);
    // Direct-play: no stream offset baked in
    expect(player.snapshot().streamOffset).toBe(0);
  });

  test("invalid progress falls back to the Plex viewOffset", () => {
    const identity = { serverId: "server-1", ratingKey: "100" };

    useProgressStore.setState({
      updatedItemsProgress: {
        [getProgressIdentityKey(identity)]: Number.NaN,
      },
    });
    player.openPlayer({ ...sampleItem, viewOffset: 90_000 });
    expect(player.snapshot().currentTime).toBe(90);

    useProgressStore.setState({
      updatedItemsProgress: {
        [getProgressIdentityKey(identity)]: Number.POSITIVE_INFINITY,
      },
    });
    player.openPlayer({ ...sampleItem, viewOffset: 120_000 });
    expect(player.snapshot().currentTime).toBe(120);
  });

  test("viewOffset path when no cached progress", () => {
    player.openPlayer({
      ...sampleItem,
      viewOffset: 90_000,
      Media: [directPlayMedia],
    });
    expect(player.snapshot().currentTime).toBe(90);
    expect(player.snapshot().streamOffset).toBe(0);
  });

  test("transcode offset baking when resumed", () => {
    // No Media codecs → decideStreamMode returns direct-stream (transcode).
    player.openPlayer({ ...sampleItem, viewOffset: 90_000 });
    expect(player.snapshot().currentTime).toBe(90);
    expect(player.snapshot().streamOffset).toBe(90);
  });

  test("startPositionSeconds wins and clamps to duration", () => {
    player.openPlayer(sampleItem, {
      resume: false,
      startPositionSeconds: 9999,
    });
    expect(player.snapshot().currentTime).toBe(600);
  });

  test("startPositionSeconds without duration is not clamped up", () => {
    const noDuration = { ...sampleItem, duration: undefined };
    player.openPlayer(noDuration, {
      resume: false,
      startPositionSeconds: 42,
    });
    expect(player.snapshot().currentTime).toBe(42);
  });

  test("assigns a fresh streamSessionId", () => {
    player.openPlayer(sampleItem, { resume: false });
    const first = player.snapshot().streamSessionId;
    expect(first.startsWith("multiplex-")).toBe(true);
    player.openPlayer(sampleItem, { resume: false });
    expect(player.snapshot().streamSessionId).not.toBe(first);
  });

  test("clears item-scoped state atomically", () => {
    player.openPlayer(sampleItem, { resume: false });
    player.updatePlaybackState({
      playQueue: { MediaContainer: {} } as never,
      playQueueId: "queue-1",
      markers: [{ id: 1 }] as never,
    });
    player.startAutoPlayCountdown(nextEpisode);

    player.openPlayer({ ...sampleItem, ratingKey: "200" }, { resume: false });

    const state = player.snapshot();
    expect(state.playQueue).toBeNull();
    expect(state.playQueueId).toBeNull();
    expect(state.markers).toEqual([]);
    expect(state.autoPlay).toEqual({
      isCountingDown: false,
      countdownSeconds: 0,
      nextEpisode: null,
    });
  });
});

describe("playback identity", () => {
  test("guards stale async success and failure updates", () => {
    player.openPlayer(sampleItem, { resume: false });
    const first = player.playbackIdentity()!;

    expect(
      player.updatePlaybackStateFor(first, { playQueueId: "queue-1" }),
    ).toBe(true);
    expect(player.snapshot().playQueueId).toBe("queue-1");

    player.openPlayer({ ...sampleItem, ratingKey: "200" }, { resume: false });
    expect(
      player.updatePlaybackStateFor(first, { playQueueId: "stale-success" }),
    ).toBe(false);
    expect(
      player.updatePlaybackStateFor(first, {
        playQueue: null,
        playQueueId: null,
        markers: [],
      }),
    ).toBe(false);
    expect(player.snapshot().currentItem?.ratingKey).toBe("200");
    expect(player.snapshot().isLoading).toBe(true);
  });

  test("pure helpers derive and compare all ownership fields", () => {
    player.openPlayer(sampleItem, { resume: false });
    const state = player.snapshot();
    const identity = getPlayerPlaybackIdentity(state)!;

    expect(identity).toEqual(player.playbackIdentity()!);
    expect(identity).toEqual({
      streamSessionId: state.streamSessionId,
      serverId: "server-1",
      ratingKey: "100",
    });
    expect(isPlayerPlaybackIdentityCurrent(state, identity)).toBe(true);
    expect(
      isPlayerPlaybackIdentityCurrent(state, {
        ...identity,
        serverId: "server-2",
      }),
    ).toBe(false);
  });
});

describe("source generation", () => {
  test("increments once for each open and close", () => {
    expect(player.snapshot().sourceGeneration).toBe(0);

    player.openPlayer({ ...sampleItem, viewOffset: 90_000 });
    expect(player.snapshot().sourceGeneration).toBe(1);

    player.openPlayer(sampleItem, { resume: false });
    expect(player.snapshot().sourceGeneration).toBe(2);

    player.closePlayer();
    expect(player.snapshot().sourceGeneration).toBe(3);
  });

  test("increments only when streamOffset actually changes", () => {
    player.openPlayer(sampleItem, { resume: false });
    const openedGeneration = player.snapshot().sourceGeneration;
    const identity = player.playbackIdentity()!;

    player.updatePlaybackStateFor(identity, { streamOffset: 20 });
    expect(player.snapshot().sourceGeneration).toBe(openedGeneration + 1);

    player.updatePlaybackStateFor(identity, { streamOffset: 20 });
    expect(player.snapshot().sourceGeneration).toBe(openedGeneration + 1);

    player.updatePlaybackState({ currentTime: 20 });
    expect(player.snapshot().sourceGeneration).toBe(openedGeneration + 1);
  });

  test("does not become part of playback request ownership", () => {
    player.openPlayer(sampleItem, { resume: false });
    const identity = player.playbackIdentity()!;

    player.updatePlaybackState({ streamOffset: 20 });

    expect(player.playbackIdentity()).toEqual(identity);
    expect(
      player.updatePlaybackStateFor(identity, { playQueueId: "queue-1" }),
    ).toBe(true);
  });
});

describe("applyPlaybackMetadata", () => {
  test("skips when streams are equal and reloadVideo is false", () => {
    const item = { ...sampleItem, Media: [directPlayMedia] };
    player.openPlayer(item, { resume: false });
    const before = player.snapshot().currentItem;
    const beforeGeneration = player.snapshot().sourceGeneration;
    player.applyPlaybackMetadata(player.playbackIdentity()!, {
      ...item,
      title: "Updated Title",
    } as ItemMetadata);
    // Streams equal → early return; title not applied
    expect(player.snapshot().currentItem?.title).toBe(before!.title);
    expect(player.snapshot().sourceGeneration).toBe(beforeGeneration);
  });

  test("reloadVideo path seeds streamOffset for transcode", () => {
    player.openPlayer(sampleItem, { resume: false });
    const beforeGeneration = player.snapshot().sourceGeneration;
    player.updatePlaybackState({ currentTime: 40 });
    player.applyPlaybackMetadata(
      player.playbackIdentity()!,
      sampleItem as unknown as ItemMetadata,
      {
        reloadVideo: true,
        preserveCurrentTime: 40,
        previousVideoUsesTranscode: true,
      },
    );
    const state = player.snapshot();
    expect(state.currentTime).toBe(40);
    expect(state.streamOffset).toBe(40);
    expect(state.isLoading).toBe(true);
    expect(state.canPlay).toBe(false);
    expect(state.sourceGeneration).toBe(beforeGeneration + 1);
  });

  test("bumps when reloadVideo reloads without changing streamOffset", () => {
    player.openPlayer(sampleItem, { resume: false });
    const beforeGeneration = player.snapshot().sourceGeneration;

    player.applyPlaybackMetadata(
      player.playbackIdentity()!,
      sampleItem as unknown as ItemMetadata,
      {
        reloadVideo: true,
        previousVideoUsesTranscode: true,
      },
    );

    expect(player.snapshot().streamOffset).toBe(0);
    expect(player.snapshot().sourceGeneration).toBe(beforeGeneration + 1);
  });

  test("does not bump for subtitle metadata hydration without reload", () => {
    const item = { ...sampleItem, Media: [directPlayMedia] };
    player.openPlayer(item, { resume: false });
    const beforeGeneration = player.snapshot().sourceGeneration;

    player.applyPlaybackMetadata(player.playbackIdentity()!, {
      ...item,
      Media: [
        {
          ...directPlayMedia,
          Part: [
            {
              ...directPlayMedia.Part?.[0],
              Stream: [
                ...(directPlayMedia.Part?.[0]?.Stream ?? []),
                {
                  id: 3,
                  streamType: 3,
                  codec: "srt",
                  key: "/library/streams/3",
                  selected: true,
                },
              ],
            },
          ],
        },
      ],
    } as ItemMetadata);

    expect(player.snapshot().sourceGeneration).toBe(beforeGeneration);
  });

  test("does not bump when reloadVideo does not reload a direct-play source", () => {
    const item = { ...sampleItem, Media: [directPlayMedia] };
    player.openPlayer(item, { resume: false });
    const beforeGeneration = player.snapshot().sourceGeneration;

    player.applyPlaybackMetadata(
      player.playbackIdentity()!,
      {
        ...item,
        title: "Hydrated",
        Media: [
          {
            ...directPlayMedia,
            Part: [
              {
                ...directPlayMedia.Part?.[0],
                Stream: [
                  ...(directPlayMedia.Part?.[0]?.Stream ?? []),
                  {
                    id: 3,
                    streamType: 3,
                    codec: "srt",
                    key: "/library/streams/3",
                    selected: true,
                  },
                ],
              },
            ],
          },
        ],
      } as ItemMetadata,
      { reloadVideo: true, previousVideoUsesTranscode: false },
    );

    expect(player.snapshot().sourceGeneration).toBe(beforeGeneration);
  });

  test("seeds streamOffset when transcoding mid-playback from zero offset", () => {
    player.openPlayer(
      { ...sampleItem, Media: [directPlayMedia] },
      { resume: false },
    );
    player.updatePlaybackState({ currentTime: 25, streamOffset: 0 });
    const beforeGeneration = player.snapshot().sourceGeneration;
    // Apply metadata without Media codecs → plan becomes transcode
    player.applyPlaybackMetadata(player.playbackIdentity()!, {
      ...sampleItem,
      title: "Hydrated",
      Media: undefined,
    } as ItemMetadata);
    expect(player.snapshot().streamOffset).toBe(25);
    expect(player.snapshot().currentItem?.title).toBe("Hydrated");
    expect(player.snapshot().sourceGeneration).toBe(beforeGeneration + 1);
  });

  test("rejects metadata for the same rating key on another server", () => {
    player.openPlayer(sampleItem, { resume: false });
    const firstServer = player.playbackIdentity()!;
    player.openPlayer(
      { ...sampleItem, serverId: "server-2", title: "Server 2" },
      { resume: false },
    );

    player.applyPlaybackMetadata(firstServer, {
      ...sampleItem,
      title: "Stale server metadata",
    } as ItemMetadata);

    expect(player.snapshot().currentItem?.title).toBe("Server 2");
  });

  test("rejects metadata from a stale playback generation", () => {
    player.openPlayer(sampleItem, { resume: false });
    const firstGeneration = player.playbackIdentity()!;
    player.openPlayer({ ...sampleItem, title: "Replay" }, { resume: false });

    player.applyPlaybackMetadata(firstGeneration, {
      ...sampleItem,
      title: "Stale generation metadata",
    } as ItemMetadata);

    expect(player.snapshot().currentItem?.title).toBe("Replay");
  });
});

describe("auto-play + close", () => {
  test("triggerAutoPlay builds next item and resets countdown", () => {
    player.openPlayer(sampleItem, { resume: false });
    player.startAutoPlayCountdown(nextEpisode);
    expect(player.snapshot().autoPlay.isCountingDown).toBe(true);

    player.triggerAutoPlay(nextEpisode);

    const state = player.snapshot();
    expect(state.autoPlay.isCountingDown).toBe(false);
    expect(state.autoPlay.nextEpisode).toBeNull();
    expect(state.currentItem?.ratingKey).toBe("101");
    expect(state.currentItem?.title).toBe("Next");
    expect(state.currentItem?.viewOffset).toBe(0);
    expect(state.currentItem?.Media).toBeUndefined();
    expect(state.currentItem?.serverId).toBe("server-1");
  });

  test("closePlayer resets playback and leaves prefs autoPlayEnabled", () => {
    usePlayerPrefsStore.getState().setAutoPlayEnabled(true);
    player.openPlayer(sampleItem, { resume: false });
    player.startAutoPlayCountdown(nextEpisode);
    player.closePlayer();

    const state = player.snapshot();
    expect(state.isOpen).toBe(false);
    expect(state.currentItem).toBeNull();
    expect(state.autoPlay.isCountingDown).toBe(false);
    expect(usePlayerPrefsStore.getState().autoPlayEnabled).toBe(true);
  });
});

describe("prefs persistence shape", () => {
  test("legacy localStorage blob round-trips autoPlay.isEnabled", () => {
    const defaults: PlayerPrefsState = {
      volume: 1,
      isMuted: false,
      playbackRate: 1,
      captionSize: "medium",
      autoPlayEnabled: true,
      setVolume: () => undefined,
      toggleMute: () => undefined,
      setPlaybackRate: () => undefined,
      setCaptionSize: () => undefined,
      setAutoPlayEnabled: () => undefined,
    };

    const legacyBlob = {
      volume: 0.4,
      isMuted: true,
      playbackRate: 1.25 as const,
      captionSize: "large" as const,
      autoPlay: {
        isEnabled: false,
        isCountingDown: true,
        countdownSeconds: 3,
        nextEpisode: { ratingKey: "x" },
      },
    };

    const loaded = prefsFromPersisted(legacyBlob, defaults);
    expect(loaded.volume).toBe(0.4);
    expect(loaded.isMuted).toBe(true);
    expect(loaded.playbackRate).toBe(1.25);
    expect(loaded.captionSize).toBe("large");
    expect(loaded.autoPlayEnabled).toBe(false);

    const persisted = partializePlayerPrefs(loaded);
    expect(persisted).toEqual({
      volume: 0.4,
      isMuted: true,
      playbackRate: 1.25,
      captionSize: "large",
      autoPlay: {
        isEnabled: false,
        isCountingDown: false,
        countdownSeconds: 0,
        nextEpisode: null,
      },
    });

    // Round-trip the written shape through merge again.
    const reloaded = prefsFromPersisted(persisted, defaults);
    expect(reloaded.autoPlayEnabled).toBe(false);
    expect(reloaded.volume).toBe(0.4);
  });

  test("validates malformed fields independently", () => {
    const defaults: PlayerPrefsState = {
      volume: 0.5,
      isMuted: true,
      playbackRate: 1.25,
      captionSize: "medium",
      autoPlayEnabled: false,
      setVolume: () => undefined,
      toggleMute: () => undefined,
      setPlaybackRate: () => undefined,
      setCaptionSize: () => undefined,
      setAutoPlayEnabled: () => undefined,
    };

    expect(
      prefsFromPersisted(
        {
          volume: Number.NaN,
          isMuted: "false",
          playbackRate: 3,
          captionSize: "huge",
          autoPlay: { isEnabled: 1 },
          autoPlayEnabled: "true",
        },
        defaults,
      ),
    ).toMatchObject({
      volume: 0.5,
      isMuted: true,
      playbackRate: 1.25,
      captionSize: "medium",
      autoPlayEnabled: false,
    });

    expect(prefsFromPersisted({ volume: 2 }, defaults).volume).toBe(1);
    expect(prefsFromPersisted({ volume: -1 }, defaults).volume).toBe(0);
    expect(
      prefsFromPersisted({ volume: Number.POSITIVE_INFINITY }, defaults).volume,
    ).toBe(0.5);
  });
});
