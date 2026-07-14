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
import type { ReactNode } from "react";

const testWindow = new Window({ url: "http://localhost/playlists/42" });
const installedGlobals = [
  "window",
  "document",
  "navigator",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLInputElement",
  "Event",
  "EventTarget",
  "MouseEvent",
  "CustomEvent",
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

function installTestGlobals() {
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: testWindow },
    document: { configurable: true, value: testWindow.document },
    navigator: { configurable: true, value: testWindow.navigator },
    Node: { configurable: true, value: testWindow.Node },
    Element: { configurable: true, value: testWindow.Element },
    HTMLElement: { configurable: true, value: testWindow.HTMLElement },
    HTMLInputElement: {
      configurable: true,
      value: testWindow.HTMLInputElement,
    },
    Event: { configurable: true, value: testWindow.Event },
    EventTarget: { configurable: true, value: testWindow.EventTarget },
    MouseEvent: { configurable: true, value: testWindow.MouseEvent },
    CustomEvent: { configurable: true, value: testWindow.CustomEvent },
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
}

installTestGlobals();

const PLAYLIST = {
  ratingKey: "42",
  title: "Road trip",
  type: "playlist",
  smart: false,
  playlistType: "audio" as const,
  leafCount: 3,
  readOnly: false,
};
const ITEMS = [
  {
    ratingKey: "100",
    key: "/library/metadata/100",
    type: "track",
    title: "One",
    playlistItemID: 7001,
  },
  {
    ratingKey: "101",
    key: "/library/metadata/101",
    type: "track",
    title: "Two",
    playlistItemID: 7002,
  },
  {
    ratingKey: "102",
    key: "/library/metadata/102",
    type: "track",
    title: "Three",
    playlistItemID: 7003,
  },
];

let playlist = PLAYLIST;
let items = ITEMS;
let totalSize = 3;
let failDelete = false;
let failMove = false;
let renameOptions: MutationOptions | undefined;
let deleteOptions: MutationOptions | undefined;
let moveOptions: MutationOptions | undefined;

interface MutationOptions {
  onSuccess?: (result: unknown, variables: never) => void | Promise<void>;
  onError?: (error: Error) => void;
}

const push = mock((_href: string) => undefined);
const rename = mock((variables: never) => {
  void renameOptions?.onSuccess?.({}, variables);
});
const remove = mock((variables: never) => {
  if (failDelete) {
    deleteOptions?.onError?.(new Error("delete failed"));
  } else {
    void deleteOptions?.onSuccess?.({}, variables);
  }
});
const move = mock((variables: never) => {
  if (failMove) {
    moveOptions?.onError?.(new Error("move failed"));
  } else {
    void moveOptions?.onSuccess?.({}, variables);
  }
});
const invalidatePlaylist = mock(() => Promise.resolve());
const invalidateContents = mock(() => Promise.resolve());
const invalidatePicker = mock(() => Promise.resolve());
const invalidateLibrary = mock(() => Promise.resolve());
const refetchContents = mock(() => Promise.resolve());
const toastSuccess = mock((_message: string) => undefined);
const toastError = mock((_message: string) => undefined);

await mock.module("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

await mock.module("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span data-image-alt={alt} />,
}));

await mock.module("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

await mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

await mock.module("~/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div role="alertdialog">{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

await mock.module("~/trpc/api", () => ({
  api: {
    useUtils: () => ({
      plex: {
        getPlaylist: { invalidate: invalidatePlaylist },
        getPlaylistContents: { invalidate: invalidateContents },
        getItemPlaylists: { invalidate: invalidatePicker },
        getLibraryPlaylists: { invalidate: invalidateLibrary },
      },
    }),
    plex: {
      getPlaylist: {
        useQuery: () => ({
          data: playlist,
          isPending: false,
          isError: false,
        }),
      },
      getPlaylistContents: {
        useQuery: () => ({
          data: {
            items,
            size: items.length,
            totalSize,
            offset: 0,
          },
          isPending: false,
          isError: false,
          isFetching: false,
          refetch: refetchContents,
        }),
      },
      renamePlaylist: {
        useMutation: (options: MutationOptions) => {
          renameOptions = options;
          return { mutate: rename, isPending: false };
        },
      },
      deletePlaylist: {
        useMutation: (options: MutationOptions) => {
          deleteOptions = options;
          return { mutate: remove, isPending: false };
        },
      },
      movePlaylistItem: {
        useMutation: (options: MutationOptions) => {
          moveOptions = options;
          return { mutate: move, isPending: false };
        },
      },
    },
  },
}));

const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { PlaylistManagement } = await import("./playlist-management");

beforeEach(() => {
  installTestGlobals();
  playlist = PLAYLIST;
  items = ITEMS;
  totalSize = 3;
  failDelete = false;
  failMove = false;
  rename.mockClear();
  remove.mockClear();
  move.mockClear();
  push.mockClear();
  invalidatePlaylist.mockClear();
  invalidateContents.mockClear();
  invalidatePicker.mockClear();
  invalidateLibrary.mockClear();
  refetchContents.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
});

afterEach(() => cleanup());

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

function renderPlaylist(librarySectionId = "7") {
  return render(
    <PlaylistManagement
      serverId="server-1"
      playlistRatingKey="42"
      librarySectionId={librarySectionId}
    />,
  );
}

describe("PlaylistManagement", () => {
  test("validates rename and invalidates all playlist views", async () => {
    const view = renderPlaylist();
    const input = view.getByLabelText("New playlist name");
    const button = view.getByRole("button", { name: "Rename" });

    fireEvent.change(input, { target: { value: "   " } });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.change(input, { target: { value: "  New name  " } });
    await act(async () => fireEvent.click(button));

    expect(rename).toHaveBeenCalledWith({
      serverId: "server-1",
      playlistRatingKey: "42",
      title: "New name",
    });
    expect(invalidatePlaylist).toHaveBeenCalled();
    expect(invalidateContents).toHaveBeenCalled();
    expect(invalidatePicker).toHaveBeenCalled();
    expect(invalidateLibrary).toHaveBeenCalled();
  });

  test("cancel keeps the playlist and confirm navigates only to the validated pivot", async () => {
    const view = renderPlaylist();
    fireEvent.click(view.getByRole("button", { name: "Delete playlist" }));
    expect(view.getByRole("alertdialog")).not.toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    expect(remove).not.toHaveBeenCalled();
    expect(view.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Delete playlist" }));
    const confirmationButtons = view.getAllByRole("button", {
      name: "Delete playlist",
    });
    await act(async () => fireEvent.click(confirmationButtons.at(-1)!));

    expect(remove).toHaveBeenCalledWith({
      serverId: "server-1",
      playlistRatingKey: "42",
    });
    expect(push).toHaveBeenCalledWith(
      "/media/server-1/com.plexapp.plugins.library?source=7&pivot=playlists",
    );
  });

  test("delete errors keep the user on the page", async () => {
    failDelete = true;
    const view = renderPlaylist();
    fireEvent.click(view.getByRole("button", { name: "Delete playlist" }));
    const confirmationButtons = view.getAllByRole("button", {
      name: "Delete playlist",
    });
    await act(async () => fireEvent.click(confirmationButtons.at(-1)!));

    expect(push).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Couldn't delete the playlist");
    expect(view.getByRole("alertdialog")).not.toBeNull();
  });

  test("delete without trusted library context falls back to home", async () => {
    const view = renderPlaylist("");
    fireEvent.click(view.getByRole("button", { name: "Delete playlist" }));
    const confirmationButtons = view.getAllByRole("button", {
      name: "Delete playlist",
    });
    await act(async () => fireEvent.click(confirmationButtons.at(-1)!));

    expect(push).toHaveBeenCalledWith("/");
  });

  test("smart and provider-readonly playlists disable every edit control", () => {
    playlist = { ...PLAYLIST, smart: true, readOnly: true };
    const view = renderPlaylist();

    expect(view.getByText("Read-only")).not.toBeNull();
    expect(
      view.getByLabelText("New playlist name").hasAttribute("disabled"),
    ).toBe(true);
    expect(
      view.getByRole("button", { name: "Rename" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      view
        .getByRole("button", { name: "Delete playlist" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      view
        .getByRole("button", { name: "Move One down" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  test("reorders middle items by direction and enforces global boundaries", async () => {
    const view = renderPlaylist();
    expect(
      view
        .getByRole("button", { name: "Move One up" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      view
        .getByRole("button", { name: "Move Three down" })
        .hasAttribute("disabled"),
    ).toBe(true);

    await act(async () =>
      fireEvent.click(view.getByRole("button", { name: "Move Two up" })),
    );
    await act(async () =>
      fireEvent.click(view.getByRole("button", { name: "Move Two down" })),
    );

    expect(move).toHaveBeenNthCalledWith(1, {
      serverId: "server-1",
      playlistRatingKey: "42",
      playlistItemId: 7002,
      direction: "up",
    });
    expect(move).toHaveBeenNthCalledWith(2, {
      serverId: "server-1",
      playlistRatingKey: "42",
      playlistItemId: 7002,
      direction: "down",
    });
  });

  test("allows cross-page adjacent moves using server-derived anchors", async () => {
    totalSize = 100;
    const view = renderPlaylist();
    fireEvent.click(view.getByRole("button", { name: "Next" }));

    const firstVisibleUp = view.getByRole("button", { name: "Move One up" });
    expect(firstVisibleUp.hasAttribute("disabled")).toBe(false);
    await act(async () => fireEvent.click(firstVisibleUp));

    expect(move).toHaveBeenCalledWith({
      serverId: "server-1",
      playlistRatingKey: "42",
      playlistItemId: 7001,
      direction: "up",
    });
  });

  test("reorder errors refetch the authoritative page", async () => {
    failMove = true;
    const view = renderPlaylist();
    await act(async () =>
      fireEvent.click(view.getByRole("button", { name: "Move Two up" })),
    );

    expect(refetchContents).toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Couldn't reorder the playlist");
  });
});
