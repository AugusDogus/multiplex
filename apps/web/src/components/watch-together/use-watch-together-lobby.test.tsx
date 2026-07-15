import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { Window } from "happy-dom";
import {
  lobby,
  type ParticipantMap,
  type SessionState,
  type WatchTogetherRoom,
} from "@multiplex/plex-query";

import type { LobbyViewModel } from "./use-watch-together-lobby";

const testWindow = new Window({
  url: "http://localhost/watch-together/A",
});
const installedGlobals = [
  "window",
  "document",
  "navigator",
  "Node",
  "Element",
  "HTMLElement",
  "Event",
  "EventTarget",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "IS_REACT_ACT_ENVIRONMENT",
] as const;
const originalGlobalDescriptors = new Map(
  installedGlobals.map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);

Object.defineProperties(globalThis, {
  window: { configurable: true, value: testWindow },
  document: { configurable: true, value: testWindow.document },
  navigator: { configurable: true, value: testWindow.navigator },
  Node: { configurable: true, value: testWindow.Node },
  Element: { configurable: true, value: testWindow.Element },
  HTMLElement: { configurable: true, value: testWindow.HTMLElement },
  Event: { configurable: true, value: testWindow.Event },
  EventTarget: { configurable: true, value: testWindow.EventTarget },
  MutationObserver: {
    configurable: true,
    value: testWindow.MutationObserver,
  },
  getComputedStyle: {
    configurable: true,
    value: testWindow.getComputedStyle.bind(testWindow),
  },
  requestAnimationFrame: {
    configurable: true,
    value: testWindow.requestAnimationFrame.bind(testWindow),
  },
  cancelAnimationFrame: {
    configurable: true,
    value: testWindow.cancelAnimationFrame.bind(testWindow),
  },
  IS_REACT_ACT_ENVIRONMENT: {
    configurable: true,
    value: true,
    writable: true,
  },
});

const ROOM: WatchTogetherRoom = {
  id: "A",
  sourceUri: "server://srv/com.plexapp.plugins.library/library/metadata/100",
  title: "Room A",
  type: "video",
  syncplayHost: "syncplay.example.com",
  syncplayPort: 443,
  users: [
    { id: 1, title: "Host", username: "host", thumb: null },
    { id: 2, title: "Guest", username: "guest", thumb: null },
  ],
};
const REMOTE_PRESENT: ParticipantMap = {
  "remote-device": {
    user: {
      id: 2,
      deviceIdentifier: "remote-device",
      deviceName: "Remote",
    },
    isPresent: true,
    isReady: false,
  },
};
const PLAYBACK_ITEM = {
  serverId: "srv",
  serverUrl: "https://server.example",
  authToken: "token",
  ratingKey: "100",
  key: "/library/metadata/100",
  title: "Episode 100",
  type: "episode",
};
const MEDIA = {
  source: { serverId: "srv", ratingKey: "100" },
  details: {
    playTarget: { ratingKey: "100" },
    serverUrl: "https://server.example",
    authToken: "token",
  },
  item: { ratingKey: "100", title: "Episode 100", type: "episode" },
  posterUrl: undefined,
  backdropUrl: undefined,
  isPending: false,
  isError: false,
};

let sessionState: SessionState = lobby({
  room: ROOM,
  participants: REMOTE_PRESENT,
  everyonePresentSticky: true,
});
let startCommand: { completion: Promise<boolean> } = {
  completion: Promise.resolve(true),
};

const push = mock((_href: string) => undefined);
const setLobbyContext = mock((_context: unknown) => undefined);
const startPlayback = mock((_input: unknown) => startCommand);
const leave = mock((_input: unknown) => ({ completion: Promise.resolve() }));
const deleteRoom = mock((_input: unknown) => undefined);
const invalidateRooms = mock(() => Promise.resolve());
const toastError = mock((_message: string) => undefined);
const sessionAtoms = await import("~/lib/effect/session-atoms");

await mock.module("next/navigation", () => ({
  useParams: () => ({ roomId: "A" }),
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

await mock.module("sonner", () => ({
  toast: { error: toastError },
}));

await mock.module(
  "~/components/watch-together/use-watch-together-room-media",
  () => ({
    useWatchTogetherRoomMedia: () => MEDIA,
  }),
);

await mock.module("~/lib/create-media-player-item", () => ({
  createMediaPlayerItem: () => PLAYBACK_ITEM,
}));

await mock.module("~/lib/device-identifier", () => ({
  getPlexClientIdentifier: () => "local-device",
  usePlexClientIdentifier: () => "local-device",
}));

await mock.module("~/lib/effect/session-atoms", () => ({
  ...sessionAtoms,
  sessionCommands: {
    getSuppressedRoomId: () => null,
    leave,
    setLobbyContext,
    snapshot: () => sessionState,
    startPlayback,
  },
  useSessionState: () => sessionState,
}));

await mock.module("~/trpc/api", () => ({
  api: {
    guestWatchTogether: {
      hostContext: {
        useQuery: () => ({ data: undefined }),
      },
    },
    useUtils: () => ({
      plex: {
        getWatchTogetherRooms: { invalidate: invalidateRooms },
      },
    }),
    plex: {
      getWatchTogetherRoom: {
        useQuery: () => ({
          data: ROOM,
          isError: false,
          isPending: false,
        }),
      },
      getUserInfo: {
        useQuery: () => ({
          data: { id: 1 },
          isError: false,
          isLoading: false,
          isPending: false,
        }),
      },
      deleteWatchTogetherRoom: {
        useMutation: () => ({ isPending: false, mutate: deleteRoom }),
      },
    },
  },
}));

const { act, cleanup, renderHook } = await import("@testing-library/react");
const { useWatchTogetherLobby } = await import("./use-watch-together-lobby");

function readyLobby(viewModel: LobbyViewModel) {
  if (viewModel.status !== "ready") {
    throw new Error(`Expected ready lobby, received ${viewModel.status}`);
  }
  return viewModel;
}

beforeEach(() => {
  sessionState = lobby({
    room: ROOM,
    participants: REMOTE_PRESENT,
    everyonePresentSticky: true,
  });
  startCommand = { completion: Promise.resolve(true) };
  push.mockClear();
  setLobbyContext.mockClear();
  startPlayback.mockClear();
  leave.mockClear();
  deleteRoom.mockClear();
  invalidateRooms.mockClear();
  toastError.mockClear();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  cleanup();
  await testWindow.happyDOM.close();
  for (const key of installedGlobals) {
    const descriptor = originalGlobalDescriptors.get(key);
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
});

describe("useWatchTogetherLobby", () => {
  test("unmounting a joined lobby leaves session ownership with the shell", () => {
    const view = renderHook(() => useWatchTogetherLobby("A"));
    expect(readyLobby(view.result.current).room.id).toBe("A");

    view.unmount();
    expect(leave).toHaveBeenCalledTimes(0);
  });

  test("a manual Start invokes the canonical command exactly once", async () => {
    const view = renderHook(() => useWatchTogetherLobby("A"));
    let started = false;

    await act(async () => {
      started = await readyLobby(view.result.current).startPlayback();
    });

    expect(started).toBe(true);
    expect(startPlayback).toHaveBeenCalledTimes(1);
    expect(startPlayback.mock.calls[0]?.[0]).toMatchObject({
      room: ROOM,
      localUser: { id: 1, deviceIdentifier: "local-device" },
      item: PLAYBACK_ITEM,
      resume: false,
    });
  });

  test("publishes auto-start eligibility to the session exactly once", () => {
    const view = renderHook(() => useWatchTogetherLobby("A"));
    expect(readyLobby(view.result.current).canStart).toBe(true);

    expect(setLobbyContext).toHaveBeenCalledTimes(1);
    expect(setLobbyContext).toHaveBeenCalledWith({
      canStart: true,
      playbackInput: { item: PLAYBACK_ITEM },
      leaving: false,
    });
    expect(startPlayback).toHaveBeenCalledTimes(0);
  });

  test("unmounting while Start is pending leaves that exact room once", async () => {
    let resolveStart: (value: boolean) => void = () => undefined;
    const pendingStart = new Promise<boolean>((resolve) => {
      resolveStart = resolve;
    });
    startCommand = { completion: pendingStart };
    const view = renderHook(() => useWatchTogetherLobby("A"));

    let completion: Promise<boolean> = Promise.resolve(false);
    act(() => {
      completion = readyLobby(view.result.current).startPlayback();
    });
    view.unmount();

    expect(startPlayback).toHaveBeenCalledTimes(1);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(leave).toHaveBeenCalledWith({
      suppressAutoStart: false,
      expectedRoomId: "A",
    });

    resolveStart(true);
    await act(async () => {
      expect(await completion).toBe(true);
    });
  });
});
