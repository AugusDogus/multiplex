import { beforeEach, expect, mock, spyOn, test } from "bun:test";

import { makePlayerPort } from "./player-port";
import { createPlayerService } from "./player-service";
import { usePlayerPrefsStore } from "~/stores/player-prefs-store";
import type { MediaPlayerItem } from "~/types/media-player";

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

function makeIsolatedPort() {
  const player = createPlayerService();
  return { port: makePlayerPort(player), player };
}

beforeEach(() => {
  usePlayerPrefsStore.setState({
    volume: 1,
    isMuted: false,
    playbackRate: 1,
    captionSize: "medium",
    autoPlayEnabled: true,
  });
});

test("load opens the media player via PlayerService", () => {
  const { port, player } = makeIsolatedPort();
  port.load(sampleItem, { resume: false });

  const state = player.snapshot();
  expect(state.isOpen).toBe(true);
  expect(state.currentItem?.ratingKey).toBe("100");
  expect(state.isLoading).toBe(true);
  expect(state.currentTime).toBe(0);
});

test("load with startPositionSeconds seeds currentTime", () => {
  const { port, player } = makeIsolatedPort();
  port.load(sampleItem, { resume: false, startPositionSeconds: 42 });

  expect(player.snapshot().currentTime).toBe(42);
});

test("close clears the media player", () => {
  const { port, player } = makeIsolatedPort();
  port.load(sampleItem, { resume: false });
  port.close();

  const state = player.snapshot();
  expect(state.isOpen).toBe(false);
  expect(state.currentItem).toBeNull();
});

test("snapshot reflects playback fields", () => {
  const { port, player } = makeIsolatedPort();
  port.load(sampleItem, { resume: false });
  player.updatePlaybackState({
    isPlaying: true,
    currentTime: 12,
    duration: 100,
    canPlay: true,
    isLoading: false,
    error: null,
  });

  expect(port.snapshot()).toEqual({
    isPlaying: true,
    currentTimeSeconds: 12,
    durationSeconds: 100,
    canPlay: true,
    isLoading: false,
    error: null,
  });
});

test("currentItem mirrors the player service item", () => {
  const { port } = makeIsolatedPort();
  expect(port.currentItem()).toBeNull();
  port.load(sampleItem, { resume: false });
  expect(port.currentItem()?.ratingKey).toBe("100");
  port.close();
  expect(port.currentItem()).toBeNull();
});

test("subscribe fires when playback snapshot fields change", async () => {
  const { port, player } = makeIsolatedPort();
  const listener = mock();
  const unsubscribe = port.subscribe(listener);

  // SubscriptionRef streams are async; give the fiber a tick.
  player.updateCurrentTime(5);
  await Bun.sleep(10);
  expect(listener).toHaveBeenCalledWith(
    expect.objectContaining({ currentTimeSeconds: 5 }),
  );

  listener.mockClear();
  // Volume is outside PlayerSnapshot — must not notify.
  player.setVolume(0.5);
  await Bun.sleep(10);
  expect(listener).not.toHaveBeenCalled();

  unsubscribe();
  player.updateCurrentTime(9);
  await Bun.sleep(10);
  expect(listener).not.toHaveBeenCalled();
});

test("play/pause/seek warn until registerActions, then delegate", () => {
  const { port } = makeIsolatedPort();
  const warn = spyOn(console, "warn").mockImplementation(() => undefined);

  void port.play();
  port.pause();
  port.seek(10);
  expect(warn).toHaveBeenCalledTimes(3);

  const actions = {
    play: mock(),
    pause: mock(),
    seek: mock(),
  };
  port.registerActions(actions);
  void port.play();
  port.pause();
  port.seek(33);

  expect(actions.play).toHaveBeenCalledTimes(1);
  expect(actions.pause).toHaveBeenCalledTimes(1);
  expect(actions.seek).toHaveBeenCalledWith(33);

  warn.mockRestore();
});

test("unregister clears actions; stale unregister does not clobber a newer registration", () => {
  const { port } = makeIsolatedPort();
  const warn = spyOn(console, "warn").mockImplementation(() => undefined);

  const first = {
    play: mock(() => true),
    pause: mock(),
    seek: mock(() => "direct" as const),
  };
  const unregisterFirst = port.registerActions(first);

  const second = {
    play: mock(() => true),
    pause: mock(),
    seek: mock(() => "direct" as const),
  };
  const unregisterSecond = port.registerActions(second);

  // Stale cleanup must not wipe the newer registration.
  unregisterFirst();
  void port.play();
  expect(second.play).toHaveBeenCalledTimes(1);
  expect(first.play).toHaveBeenCalledTimes(0);
  expect(warn).not.toHaveBeenCalled();

  unregisterSecond();
  warn.mockClear();
  void port.play();
  port.pause();
  expect(port.seek(1)).toBe("none");
  expect(warn).toHaveBeenCalledTimes(3);
  expect(second.play).toHaveBeenCalledTimes(1);

  warn.mockRestore();
});
