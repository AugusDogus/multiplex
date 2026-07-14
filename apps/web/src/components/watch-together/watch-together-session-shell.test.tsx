import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { StrictMode } from "react";
import { Window } from "happy-dom";
import {
  Idle,
  playing,
  type PlayingItem,
  type SessionState,
  type WatchTogetherRoom,
} from "@multiplex/plex-query";

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

const room = (id: string): WatchTogetherRoom => ({
  id,
  sourceUri: `server://srv/com.plexapp.plugins.library/library/metadata/${id}`,
  title: `Room ${id}`,
  type: "video",
  syncplayHost: "syncplay.example.com",
  syncplayPort: 443,
  users: [],
});
const rooms = { A: room("A"), B: room("B") } as const;
const playingItem: PlayingItem = {
  serverId: "srv",
  ratingKey: "100",
  key: "/library/metadata/100",
  title: "Episode 100",
  type: "episode",
};

let routeRoomId: keyof typeof rooms = "A";
let sessionState: SessionState = Idle;

const replace = mock((_href: string) => undefined);
const enterLobby = mock((_input: unknown) => ({
  completion: Promise.resolve(),
}));
const exitLobby = mock((_input: unknown) => ({
  completion: Promise.resolve(),
}));
const sessionAtoms = await import("~/lib/effect/session-atoms");

await mock.module("next/navigation", () => ({
  useParams: () => ({ roomId: routeRoomId }),
  useRouter: () => ({ replace }),
}));

await mock.module("~/lib/device-identifier", () => ({
  getPlexClientIdentifier: () => "local-device",
}));

await mock.module("~/lib/effect/session-atoms", () => ({
  ...sessionAtoms,
  sessionCommands: { enterLobby, exitLobby },
  useSessionState: () => sessionState,
}));

await mock.module("~/trpc/api", () => ({
  api: {
    plex: {
      getWatchTogetherRoom: {
        useQuery: () => ({ data: rooms[routeRoomId] }),
      },
      getUserInfo: {
        useQuery: () => ({ data: { id: 7 } }),
      },
    },
  },
}));

const { cleanup, render } = await import("@testing-library/react");
const { WatchTogetherSessionShell } = await import(
  "./watch-together-session-shell"
);

beforeEach(() => {
  routeRoomId = "A";
  sessionState = Idle;
  testWindow.happyDOM.setURL("http://localhost/watch-together/A");
  replace.mockClear();
  enterLobby.mockClear();
  exitLobby.mockClear();
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

describe("WatchTogetherSessionShell", () => {
  test("cleans up room A before owning room B and cleans B on unmount", () => {
    const view = render(
      <WatchTogetherSessionShell>
        <div>Lobby</div>
      </WatchTogetherSessionShell>,
    );

    expect(enterLobby).toHaveBeenCalledTimes(1);
    expect(enterLobby.mock.calls[0]?.[0]).toMatchObject({
      room: rooms.A,
      localUser: { id: 7, deviceIdentifier: "local-device" },
    });

    routeRoomId = "B";
    testWindow.happyDOM.setURL("http://localhost/watch-together/B");
    view.rerender(
      <WatchTogetherSessionShell>
        <div>Lobby</div>
      </WatchTogetherSessionShell>,
    );

    expect(exitLobby).toHaveBeenCalledTimes(1);
    expect(exitLobby).toHaveBeenNthCalledWith(1, { expectedRoomId: "A" });
    expect(enterLobby).toHaveBeenCalledTimes(2);
    expect(enterLobby.mock.calls[1]?.[0]).toMatchObject({ room: rooms.B });

    view.unmount();
    expect(exitLobby).toHaveBeenCalledTimes(2);
    expect(exitLobby).toHaveBeenNthCalledWith(2, { expectedRoomId: "B" });
  });

  test("replaces the route when the canonical Playing room changes", () => {
    sessionState = playing({ room: rooms.B, item: playingItem });

    render(
      <WatchTogetherSessionShell>
        <div>Playing</div>
      </WatchTogetherSessionShell>,
    );

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/watch-together/B");
  });

  test("does not let a stale Playing render navigate a newly selected route", () => {
    sessionState = playing({ room: rooms.A, item: playingItem });
    const view = render(
      <WatchTogetherSessionShell>
        <div>Playing</div>
      </WatchTogetherSessionShell>,
    );
    expect(replace).toHaveBeenCalledTimes(0);

    routeRoomId = "B";
    sessionState = Idle;
    testWindow.happyDOM.setURL("http://localhost/watch-together/B");
    view.rerender(
      <WatchTogetherSessionShell>
        <div>Lobby B</div>
      </WatchTogetherSessionShell>,
    );

    expect(replace).toHaveBeenCalledTimes(0);
  });

  test("StrictMode repeats only the documented idempotent lifecycle commands", () => {
    const view = render(
      <StrictMode>
        <WatchTogetherSessionShell>
          <div>Lobby</div>
        </WatchTogetherSessionShell>
      </StrictMode>,
    );

    expect(enterLobby).toHaveBeenCalledTimes(2);
    expect(exitLobby).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(enterLobby).toHaveBeenCalledTimes(2);
    expect(exitLobby).toHaveBeenCalledTimes(2);
  });
});
