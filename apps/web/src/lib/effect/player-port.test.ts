import { beforeEach, expect, mock, spyOn, test } from "bun:test";

import { makePlayerPort } from "./player-port";
import { useMediaPlayerStore } from "~/stores/media-player-store";
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

beforeEach(() => {
  useMediaPlayerStore.getState().closePlayer();
});

test("load opens the media player via the Zustand store", () => {
  const port = makePlayerPort();
  port.load(sampleItem, { resume: false });

  const state = useMediaPlayerStore.getState();
  expect(state.isOpen).toBe(true);
  expect(state.currentItem?.ratingKey).toBe("100");
  expect(state.isLoading).toBe(true);
  expect(state.currentTime).toBe(0);
});

test("load with startPositionSeconds seeds currentTime", () => {
  const port = makePlayerPort();
  port.load(sampleItem, { resume: false, startPositionSeconds: 42 });

  expect(useMediaPlayerStore.getState().currentTime).toBe(42);
});

test("close clears the media player", () => {
  const port = makePlayerPort();
  port.load(sampleItem, { resume: false });
  port.close();

  const state = useMediaPlayerStore.getState();
  expect(state.isOpen).toBe(false);
  expect(state.currentItem).toBeNull();
});

test("snapshot reflects store playback fields", () => {
  const port = makePlayerPort();
  port.load(sampleItem, { resume: false });
  useMediaPlayerStore.getState().updatePlaybackState({
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

test("subscribe fires when playback snapshot fields change", () => {
  const port = makePlayerPort();
  const listener = mock();
  const unsubscribe = port.subscribe(listener);

  useMediaPlayerStore.getState().updateCurrentTime(5);
  expect(listener).toHaveBeenCalledWith(
    expect.objectContaining({ currentTimeSeconds: 5 }),
  );

  listener.mockClear();
  // Volume is outside PlayerSnapshot — must not notify.
  useMediaPlayerStore.getState().setVolume(0.5);
  expect(listener).not.toHaveBeenCalled();

  unsubscribe();
  useMediaPlayerStore.getState().updateCurrentTime(9);
  expect(listener).not.toHaveBeenCalled();
});

test("play/pause/seek warn until registerActions, then delegate", () => {
  const port = makePlayerPort();
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
