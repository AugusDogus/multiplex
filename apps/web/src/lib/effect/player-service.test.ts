import { beforeEach, describe, expect, test } from "bun:test";
import type { ItemMetadata } from "@multiplex/plex-query";

import {
  createPlayerService,
  getBufferedPercent,
  getFormattedCurrentTime,
  getIsReady,
  getPlayerStatus,
  getProgressPercent,
  type PlayerServiceShape,
} from "./player-service";
import {
  partializePlayerPrefs,
  prefsFromPersisted,
  usePlayerPrefsStore,
  type PlayerPrefsState,
} from "~/stores/player-prefs-store";
import { useProgressStore } from "~/stores/progress-store";
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

  test("progress-store percent path seeds currentTime", () => {
    useProgressStore.getState().updateItemProgress({
      ratingKey: "100",
      progressPercent: 50,
    });
    player.openPlayer({ ...sampleItem, Media: [directPlayMedia] });
    expect(player.snapshot().currentTime).toBe(300);
    // Direct-play: no stream offset baked in
    expect(player.snapshot().streamOffset).toBe(0);
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
});

describe("applyPlaybackMetadata", () => {
  test("skips when streams are equal and reloadVideo is false", () => {
    const item = { ...sampleItem, Media: [directPlayMedia] };
    player.openPlayer(item, { resume: false });
    const before = player.snapshot().currentItem;
    player.applyPlaybackMetadata({
      ...item,
      title: "Updated Title",
    } as ItemMetadata);
    // Streams equal → early return; title not applied
    expect(player.snapshot().currentItem?.title).toBe(before!.title);
  });

  test("reloadVideo path seeds streamOffset for transcode", () => {
    player.openPlayer(sampleItem, { resume: false });
    player.updatePlaybackState({ currentTime: 40 });
    player.applyPlaybackMetadata(sampleItem as unknown as ItemMetadata, {
      reloadVideo: true,
      preserveCurrentTime: 40,
      previousVideoUsesTranscode: true,
    });
    const state = player.snapshot();
    expect(state.currentTime).toBe(40);
    expect(state.streamOffset).toBe(40);
    expect(state.isLoading).toBe(true);
    expect(state.canPlay).toBe(false);
  });

  test("seeds streamOffset when transcoding mid-playback from zero offset", () => {
    player.openPlayer(
      { ...sampleItem, Media: [directPlayMedia] },
      { resume: false },
    );
    player.updatePlaybackState({ currentTime: 25, streamOffset: 0 });
    // Apply metadata without Media codecs → plan becomes transcode
    player.applyPlaybackMetadata({
      ...sampleItem,
      title: "Hydrated",
      Media: undefined,
    } as ItemMetadata);
    expect(player.snapshot().streamOffset).toBe(25);
    expect(player.snapshot().currentItem?.title).toBe("Hydrated");
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

  test("setAutoPlayEnabled(false) clears countdown and writes prefs", () => {
    player.openPlayer(sampleItem, { resume: false });
    player.startAutoPlayCountdown(nextEpisode);
    player.setAutoPlayEnabled(false);

    expect(usePlayerPrefsStore.getState().autoPlayEnabled).toBe(false);
    expect(player.snapshot().autoPlay.isCountingDown).toBe(false);
    expect(player.snapshot().autoPlay.nextEpisode).toBeNull();
  });
});

describe("pure getters", () => {
  test("progress / buffered / formatted / status / ready", () => {
    player.updatePlaybackState({
      currentTime: 30,
      duration: 100,
      bufferedTime: 50,
      canPlay: true,
      isLoading: false,
      error: null,
      currentItem: sampleItem,
    });
    const s = player.snapshot();
    expect(getProgressPercent(s)).toBe(30);
    expect(getBufferedPercent(s)).toBe(50);
    expect(getFormattedCurrentTime(s)).toMatch(/0?0:30|30/);
    expect(getPlayerStatus(s).status).toBe("ready");
    expect(getIsReady(s)).toBe(true);
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
});
