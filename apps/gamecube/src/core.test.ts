import { expect, test } from "bun:test";

import {
  clearPlaybackNavigationRequest,
  completeMarkWatched,
  completeWatchTogetherDisband,
  completeWatchTogetherJoin,
  completeWatchTogetherLeave,
  completeWatchTogetherReconnect,
  dismissToast,
  failBrowse,
  failDetails,
  failPlayback,
  failSearch,
  failWatchTogetherCreate,
  initialModel,
  loadBootDiagnostics,
  loadBrowse,
  loadCatalog,
  loadDetails,
  loadDetailsChildren,
  loadPairing,
  loadPlayback,
  loadSearch,
  loadSubtitleStreams,
  loadWatchTogetherInvitees,
  loadWatchTogetherRooms,
  type CatalogItem,
  type CatalogRow,
  type Model,
  type Msg,
  moveHomeCarousel,
  previewCatalogItem,
  setWatchTogetherHost,
  showToast,
  transitionPlayback,
  update,
  updateWatchTogetherPresence,
} from "./core.ts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const item = (id = 0): CatalogItem => ({
  id,
  ratingKey: id + 100,
  title: bytes(`Item ${id}`),
  subtitle: bytes("Movie"),
  secondary: bytes("Movie"),
  hierarchy: new Uint8Array(0),
  hasHierarchy: false,
  imageId: id + 200,
  durationMs: 120_000,
  viewOffsetMs: id * 1_000,
  progressPercent: 0,
});

const row = (...items: readonly CatalogItem[]): CatalogRow => ({
  id: 1,
  title: bytes("Row"),
  items,
});

const model = (overrides: Partial<Model> = {}): Model => ({
  ...initialModel(),
  rows: [row(item(1), item(2)), row(item(3), item(4))],
  libraries: [
    {
      id: 1,
      sectionId: 10,
      title: bytes("Films"),
      mediaType: 1,
      typeLabel: bytes("Movies"),
    },
  ],
  ...overrides,
});

type ReducerCase<Kind extends Msg["kind"] = Msg["kind"]> = {
  readonly start: Partial<Model>;
  readonly message: Extract<Msg, { readonly kind: Kind }>;
  readonly expected: Partial<Model>;
};

type ReducerCases = {
  readonly [Kind in Msg["kind"]]: ReducerCase<Kind>;
};

const invitees = Array.from({ length: 5 }, (_, index) => ({
  id: index,
  userId: index + 10,
  title: bytes(`User ${index}`),
}));

const reducerCases = {
  connect_demo: {
    start: {},
    message: { kind: "connect_demo" },
    expected: { screen: "home" },
  },
  previous_row: {
    start: { rowIndex: 1, rowNumber: 2, selectedIndex: 1 },
    message: { kind: "previous_row" },
    expected: {
      rowIndex: 0,
      rowNumber: 1,
      selectedRatingKey: 102,
      selectedImageId: 202,
      selectedTitle: item(2).title,
      selectedDurationMs: 120_000,
      selectedViewOffsetMs: 2_000,
    },
  },
  next_row: {
    start: { selectedIndex: 1 },
    message: { kind: "next_row" },
    expected: {
      rowIndex: 1,
      rowNumber: 2,
      selectedRatingKey: 104,
      selectedImageId: 204,
      selectedTitle: item(4).title,
      selectedDurationMs: 120_000,
      selectedViewOffsetMs: 4_000,
    },
  },
  open_libraries: {
    start: { pairingLinked: true },
    message: { kind: "open_libraries" },
    expected: { screen: "libraries" },
  },
  open_library: {
    start: {},
    message: { kind: "open_library", index: 0 },
    expected: {
      screen: "browse",
      selectedLibraryId: 10,
      selectedLibraryTitle: bytes("Films"),
      browseItems: [],
      browseTotal: 0,
      browseLoaded: false,
    },
  },
  browse_previous_row: {
    start: {
      screen: "browse",
      browseStart: 7,
      browsePendingStart: 7,
      selectedIndex: 8,
    },
    message: { kind: "browse_previous_row" },
    expected: { browsePendingStart: 0, selectedIndex: 1 },
  },
  browse_next_row: {
    start: {
      screen: "browse",
      browseItems: Array.from({ length: 14 }, (_, index) => item(index)),
      browseTotal: 21,
      selectedIndex: 1,
    },
    message: { kind: "browse_next_row" },
    expected: { browsePendingStart: 7, selectedIndex: 8 },
  },
  open_search: {
    start: {
      pairingLinked: true,
      searchQuery: bytes("old"),
      searchCursor: 2,
      searchItems: [item()],
    },
    message: { kind: "open_search" },
    expected: {
      screen: "search",
      searchQuery: new Uint8Array(0),
      searchCursor: 0,
      searchItems: [],
      searchLoaded: true,
      searchFailed: false,
    },
  },
  search_key: {
    start: { screen: "search" },
    message: { kind: "search_key", index: 0 },
    expected: { searchQuery: bytes("Q"), searchCursor: 1 },
  },
  search_delete: {
    start: { screen: "search", searchQuery: bytes("AB"), searchCursor: 2 },
    message: { kind: "search_delete" },
    expected: { searchQuery: bytes("A"), searchCursor: 1 },
  },
  search_cursor_left: {
    start: { screen: "search", searchCursor: 1 },
    message: { kind: "search_cursor_left" },
    expected: { searchCursor: 0 },
  },
  search_cursor_right: {
    start: { screen: "search", searchQuery: bytes("A") },
    message: { kind: "search_cursor_right" },
    expected: { searchCursor: 1 },
  },
  search_submit: {
    start: {
      screen: "search",
      searchQuery: bytes("Alien"),
      searchItems: [item()],
    },
    message: { kind: "search_submit" },
    expected: {
      screen: "search_results",
      searchItems: [],
      searchLoaded: false,
      searchFailed: false,
    },
  },
  open_watch_together: {
    start: { pairingLinked: true, startMenuOpen: true },
    message: { kind: "open_watch_together" },
    expected: { screen: "watch_together", startMenuOpen: false },
  },
  open_start_menu: {
    start: { pairingLinked: true, screen: "details" },
    message: { kind: "open_start_menu" },
    expected: { startMenuOpen: true },
  },
  close_start_menu: {
    start: { startMenuOpen: true },
    message: { kind: "close_start_menu" },
    expected: { startMenuOpen: false },
  },
  start_menu_play: {
    start: {
      screen: "details",
      startMenuOpen: true,
      selectedDurationMs: 60_000,
      selectedViewOffsetMs: 10_000,
    },
    message: { kind: "start_menu_play" },
    expected: {
      screen: "player",
      startMenuOpen: false,
      playbackOffsetMs: 10_000,
      playing: true,
    },
  },
  start_menu_mark_watched: {
    start: { screen: "details", startMenuOpen: true },
    message: { kind: "start_menu_mark_watched" },
    expected: { startMenuOpen: false, markWatchedRequested: true },
  },
  start_menu_create_watch_together: {
    start: { pairingLinked: true, screen: "details", startMenuOpen: true },
    message: { kind: "start_menu_create_watch_together" },
    expected: { screen: "watch_together_invite", startMenuOpen: false },
  },
  create_watch_together: {
    start: { pairingLinked: true, screen: "details" },
    message: { kind: "create_watch_together" },
    expected: {
      screen: "watch_together_invite",
      watchTogetherInviteePage: 0,
      watchTogetherCreateFailed: false,
    },
  },
  watch_together_invitees_previous: {
    start: { screen: "watch_together_invite", watchTogetherInviteePage: 1 },
    message: { kind: "watch_together_invitees_previous" },
    expected: { watchTogetherInviteePage: 0 },
  },
  watch_together_invitees_next: {
    start: { screen: "watch_together_invite", watchTogetherInvitees: invitees },
    message: { kind: "watch_together_invitees_next" },
    expected: { watchTogetherInviteePage: 1 },
  },
  invite_watch_together: {
    start: {
      screen: "watch_together_invite",
      watchTogetherInvitees: [{ id: 1, userId: 42, title: bytes("Friend") }],
    },
    message: { kind: "invite_watch_together", index: 0 },
    expected: {
      screen: "watch_together",
      selectedWatchTogetherInviteeId: 42,
      watchTogetherCreating: true,
    },
  },
  join_watch_together: {
    start: {
      screen: "watch_together",
      watchTogetherRooms: [{ id: 1, title: bytes("Room"), participantCount: 2 }],
      watchTogetherHost: true,
    },
    message: { kind: "join_watch_together", index: 0 },
    expected: {
      screen: "watch_together_room",
      selectedWatchTogetherRoomIndex: 0,
      watchTogetherJoining: true,
      watchTogetherHost: false,
    },
  },
  leave_watch_together: {
    start: {
      screen: "player",
      watchTogetherActive: true,
      selectedDurationMs: 120_000,
      playbackOffsetMs: 4_000,
    },
    message: { kind: "leave_watch_together" },
    expected: {
      screen: "watch_together",
      playbackLoaded: false,
      playing: false,
      selectedViewOffsetMs: 4_000,
      rows: [
        row({ ...item(1), viewOffsetMs: 4_000, progressPercent: 3 }, item(2)),
        row(item(3), item(4)),
      ],
      watchTogetherActive: false,
      watchTogetherLeaveRequested: true,
    },
  },
  reconnect_watch_together: {
    start: { screen: "player", watchTogetherActive: true },
    message: { kind: "reconnect_watch_together" },
    expected: { watchTogetherReconnectRequested: true },
  },
  disband_watch_together: {
    start: {
      screen: "player",
      watchTogetherActive: true,
      watchTogetherHost: true,
      selectedDurationMs: 120_000,
      playbackOffsetMs: 4_000,
    },
    message: { kind: "disband_watch_together" },
    expected: {
      screen: "watch_together",
      playbackLoaded: false,
      selectedViewOffsetMs: 4_000,
      rows: [
        row({ ...item(1), viewOffsetMs: 4_000, progressPercent: 3 }, item(2)),
        row(item(3), item(4)),
      ],
      watchTogetherActive: false,
      watchTogetherLeaveRequested: false,
      watchTogetherDisbandRequested: true,
      watchTogetherDisbandFailed: false,
    },
  },
  open_item: {
    start: { screen: "browse", browseItems: [item(9)], gatewayConnected: true },
    message: { kind: "open_item", index: 0 },
    expected: {
      screen: "details",
      selectedRatingKey: 109,
      selectedImageId: 209,
      selectedTitle: item(9).title,
      selectedDurationMs: 120_000,
      selectedViewOffsetMs: 9_000,
      selectedFromBrowse: true,
      detailsLoaded: false,
      detailsChildrenLoaded: false,
    },
  },
  open_details_child: {
    start: {
      screen: "details",
      selectedRatingKey: 101,
      detailsChildren: [item(8)],
    },
    message: { kind: "open_details_child", index: 0 },
    expected: {
      selectedRatingKey: 108,
      selectedTitle: item(8).title,
      selectedDurationMs: 120_000,
      selectedViewOffsetMs: 8_000,
      detailsLoaded: false,
      detailsChildren: [],
      detailsChildrenLoaded: false,
      detailsHistory: [
        {
          id: 0,
          ratingKey: 101,
          title: bytes("The Fifth Element"),
          subtitle: bytes("Movie"),
          secondary: bytes("Movie"),
          hierarchy: new Uint8Array(0),
          hasHierarchy: false,
          imageId: 1,
          durationMs: 0,
          viewOffsetMs: 0,
          progressPercent: 0,
        },
      ],
    },
  },
  details_children_previous: {
    start: { screen: "details", detailsChildrenStart: 4 },
    message: { kind: "details_children_previous" },
    expected: { detailsChildrenStart: 0, detailsChildrenLoaded: false },
  },
  details_children_next: {
    start: {
      screen: "details",
      detailsChildren: [item()],
      detailsChildrenTotal: 5,
    },
    message: { kind: "details_children_next" },
    expected: { detailsChildrenStart: 4, detailsChildrenLoaded: false },
  },
  play: {
    start: {
      screen: "details",
      selectedDurationMs: 60_000,
      selectedViewOffsetMs: 80_000,
    },
    message: { kind: "play" },
    expected: { screen: "player", playbackOffsetMs: 59_999, playing: true },
  },
  mark_watched: {
    start: { screen: "details" },
    message: { kind: "mark_watched" },
    expected: { markWatchedRequested: true },
  },
  seek_backward: {
    start: { screen: "player", playbackOffsetMs: 15_000 },
    message: { kind: "seek_backward" },
    expected: {
      playbackOffsetMs: 5_000,
      playbackLoaded: false,
      playing: false,
    },
  },
  seek_forward: {
    start: {
      screen: "player",
      selectedDurationMs: 20_000,
      playbackOffsetMs: 5_000,
    },
    message: { kind: "seek_forward" },
    expected: {
      playbackOffsetMs: 19_999,
      playbackLoaded: false,
      playing: false,
    },
  },
  open_player_settings: {
    start: { screen: "player" },
    message: { kind: "open_player_settings" },
    expected: { playerSettingsOpen: true },
  },
  close_player_settings: {
    start: { playerSettingsOpen: true },
    message: { kind: "close_player_settings" },
    expected: { playerSettingsOpen: false },
  },
  toggle_stats_for_nerds: {
    start: { screen: "player", playerSettingsOpen: true },
    message: { kind: "toggle_stats_for_nerds" },
    expected: { statsForNerdsEnabled: true },
  },
  stop_playback: {
    start: {
      screen: "player",
      playbackOffsetMs: 10_000,
      selectedDurationMs: 120_000,
    },
    message: { kind: "stop_playback" },
    expected: {
      screen: "details",
      selectedViewOffsetMs: 10_000,
      playing: false,
      rows: [
        row({ ...item(1), viewOffsetMs: 10_000, progressPercent: 8 }, item(2)),
        row(item(3), item(4)),
      ],
    },
  },
  play_previous: {
    start: { screen: "player" },
    message: { kind: "play_previous" },
    expected: { playbackNavigationRequest: -1 },
  },
  play_next: {
    start: { screen: "player" },
    message: { kind: "play_next" },
    expected: { playbackNavigationRequest: 1 },
  },
  sync_playback: {
    start: { screen: "player", selectedDurationMs: 10_000 },
    message: { kind: "sync_playback", positionMs: 20_000 },
    expected: { playbackOffsetMs: 9_999 },
  },
  continue_playback: {
    start: {
      screen: "player",
      selectedDurationMs: 10_000,
      playbackOffsetMs: 1_000,
    },
    message: { kind: "continue_playback", positionMs: 2_000 },
    expected: {
      playbackOffsetMs: 2_000,
      playbackLoaded: false,
      playing: false,
    },
  },
  complete_playback: {
    start: { screen: "player", selectedDurationMs: 10_000, playing: true },
    message: { kind: "complete_playback" },
    expected: { playbackOffsetMs: 9_999, playing: false },
  },
  toggle_playback: {
    start: { screen: "player" },
    message: { kind: "toggle_playback" },
    expected: { playing: true },
  },
  cycle_subtitles: {
    start: {
      screen: "player",
      subtitleStreamCount: 2,
      selectedSubtitleStream: 2,
      playing: true,
    },
    message: { kind: "cycle_subtitles" },
    expected: {
      selectedSubtitleStream: 0,
      playbackLoaded: false,
      playing: false,
    },
  },
  back: {
    start: { screen: "player", playerSettingsOpen: true },
    message: { kind: "back" },
    expected: { screen: "player", playerSettingsOpen: false },
  },
} satisfies ReducerCases;

for (const reducerCase of Object.values(reducerCases)) {
  test(`update characterizes ${reducerCase.message.kind}`, () => {
    const startingModel = model(reducerCase.start);

    expect(update(startingModel, reducerCase.message)).toEqual({
      ...startingModel,
      ...reducerCase.expected,
    });
  });
}

type GuardedCase = {
  readonly name: string;
  readonly start: Partial<Model>;
  readonly message: Msg;
};

const guardedCases = [
  {
    name: "rejects an invalid library index",
    start: { screen: "libraries" },
    message: { kind: "open_library", index: 1 },
  },
  {
    name: "rejects an invalid search key index",
    start: { screen: "search", searchQuery: bytes("A"), searchCursor: 1 },
    message: { kind: "search_key", index: 26 },
  },
  {
    name: "keeps home navigation at the first row",
    start: { screen: "home", rowIndex: 0, rowNumber: 1 },
    message: { kind: "previous_row" },
  },
  {
    name: "keeps home navigation at the last row",
    start: { screen: "home", rowIndex: 1, rowNumber: 2 },
    message: { kind: "next_row" },
  },
  {
    name: "keeps subtitle selection when streams are empty",
    start: { screen: "player", subtitleStreams: [], subtitleStreamCount: 0 },
    message: { kind: "cycle_subtitles" },
  },
  {
    name: "ignores playback toggles before playback loads",
    start: { screen: "player", playbackLoaded: false },
    message: { kind: "toggle_playback" },
  },
] satisfies readonly GuardedCase[];

for (const guardedCase of guardedCases) {
  test(`update ${guardedCase.name}`, () => {
    const startingModel = model(guardedCase.start);

    expect(update(startingModel, guardedCase.message)).toEqual(startingModel);
  });
}

type BackCase = {
  readonly name: string;
  readonly start: Partial<Model>;
  readonly expected: Partial<Model>;
};

const backCases = [
  {
    name: "closes the start menu",
    start: { screen: "details", startMenuOpen: true },
    expected: { screen: "details", startMenuOpen: false },
  },
  {
    name: "returns home playback to details and records progress",
    start: {
      screen: "player",
      selectedDurationMs: 120_000,
      playbackOffsetMs: 60_000,
      playing: true,
    },
    expected: {
      screen: "details",
      playing: false,
      selectedViewOffsetMs: 60_000,
      rows: [
        row({ ...item(1), viewOffsetMs: 60_000, progressPercent: 50 }, item(2)),
        row(item(3), item(4)),
      ],
    },
  },
  {
    name: "returns browse playback to details and records progress",
    start: {
      screen: "player",
      browseItems: [item(5)],
      selectedDurationMs: 120_000,
      playbackOffsetMs: 30_000,
      selectedFromBrowse: true,
    },
    expected: {
      screen: "details",
      selectedViewOffsetMs: 30_000,
      browseItems: [{ ...item(5), viewOffsetMs: 30_000, progressPercent: 25 }],
    },
  },
  {
    name: "returns search playback to details and records progress",
    start: {
      screen: "player",
      searchItems: [item(6)],
      selectedDurationMs: 120_000,
      playbackOffsetMs: 90_000,
      selectedFromSearch: true,
    },
    expected: {
      screen: "details",
      selectedViewOffsetMs: 90_000,
      searchItems: [{ ...item(6), viewOffsetMs: 90_000, progressPercent: 75 }],
    },
  },
  {
    name: "leaves active Watch Together playback",
    start: {
      screen: "player",
      watchTogetherActive: true,
      watchTogetherConnected: true,
      watchTogetherPresentCount: 3,
      watchTogetherReconnectRequested: true,
      selectedDurationMs: 120_000,
      playbackOffsetMs: 30_000,
      playing: true,
    },
    expected: {
      screen: "watch_together",
      playbackLoaded: false,
      playing: false,
      selectedViewOffsetMs: 30_000,
      rows: [
        row({ ...item(1), viewOffsetMs: 30_000, progressPercent: 25 }, item(2)),
        row(item(3), item(4)),
      ],
      watchTogetherActive: false,
      watchTogetherConnected: false,
      watchTogetherPresentCount: 0,
      watchTogetherLeaveRequested: true,
      watchTogetherReconnectRequested: false,
    },
  },
  {
    name: "returns details to its parent",
    start: {
      screen: "details",
      selectedRatingKey: 109,
      detailsChildren: [item(9)],
      detailsChildrenStart: 4,
      detailsChildrenPageNumber: 2,
      detailsChildrenPageCount: 3,
      detailsChildrenTotal: 9,
      detailsChildrenLoaded: true,
      detailsHistory: [item(8)],
    },
    expected: {
      screen: "details",
      selectedRatingKey: 108,
      selectedImageId: 208,
      selectedTitle: item(8).title,
      selectedDurationMs: 120_000,
      selectedViewOffsetMs: 8_000,
      detailsLoaded: false,
      detailsChildren: [],
      detailsChildrenStart: 0,
      detailsChildrenPageNumber: 1,
      detailsChildrenPageCount: 1,
      detailsChildrenTotal: 0,
      detailsChildrenLoaded: false,
      detailsHistory: [],
    },
  },
  {
    name: "returns browse details to browse",
    start: { screen: "details", selectedFromBrowse: true },
    expected: { screen: "browse" },
  },
  {
    name: "returns search details to search results",
    start: { screen: "details", selectedFromSearch: true },
    expected: { screen: "search_results" },
  },
  {
    name: "returns home details to home",
    start: { screen: "details" },
    expected: { screen: "home" },
  },
  {
    name: "returns search results to search",
    start: { screen: "search_results" },
    expected: { screen: "search" },
  },
  {
    name: "returns search to home",
    start: { screen: "search" },
    expected: { screen: "home" },
  },
  {
    name: "returns Watch Together to home",
    start: { screen: "watch_together" },
    expected: { screen: "home" },
  },
  {
    name: "returns Watch Together invites to details",
    start: { screen: "watch_together_invite" },
    expected: { screen: "details" },
  },
  {
    name: "returns a Watch Together room to its room list",
    start: {
      screen: "watch_together_room",
      watchTogetherJoining: true,
      watchTogetherConnected: true,
      watchTogetherJoinFailed: true,
    },
    expected: {
      screen: "watch_together",
      watchTogetherJoining: false,
      watchTogetherConnected: false,
      watchTogetherJoinFailed: false,
    },
  },
  {
    name: "returns browse to libraries",
    start: { screen: "browse" },
    expected: { screen: "libraries" },
  },
  {
    name: "returns libraries to home",
    start: { screen: "libraries" },
    expected: { screen: "home" },
  },
  {
    name: "keeps home at home",
    start: { screen: "home" },
    expected: { screen: "home" },
  },
  {
    name: "keeps pairing at pairing",
    start: { screen: "pairing" },
    expected: { screen: "pairing" },
  },
] satisfies readonly BackCase[];

for (const backCase of backCases) {
  test(`back ${backCase.name}`, () => {
    const startingModel = model(backCase.start);

    expect(update(startingModel, { kind: "back" })).toEqual({
      ...startingModel,
      ...backCase.expected,
    });
  });
}

const expectTransition = (actual: Model, before: Model, expected: Partial<Model>): void => {
  expect(actual).toEqual({ ...before, ...expected });
};

test("loadPairing owns every gateway status", () => {
  const statuses = [
    { status: 0, connecting: false, waiting: false, linked: false, unavailable: false },
    { status: 1, connecting: false, waiting: true, linked: false, unavailable: false },
    { status: 2, connecting: false, waiting: false, linked: true, unavailable: false },
    { status: 3, connecting: false, waiting: false, linked: false, unavailable: true },
    { status: 4, connecting: true, waiting: false, linked: false, unavailable: false },
  ] satisfies ReadonlyArray<{
    readonly status: number;
    readonly connecting: boolean;
    readonly waiting: boolean;
    readonly linked: boolean;
    readonly unavailable: boolean;
  }>;

  for (const status of statuses) {
    const before = model();
    const next = loadPairing(before, status.status, bytes("1234"), bytes("https://plex"));
    expectTransition(next, before, {
      pairingEnabled: true,
      pairingConnecting: status.connecting,
      pairingWaiting: status.waiting,
      pairingLinked: status.linked,
      pairingUnavailable: status.unavailable,
      pairingCode: bytes("1234"),
      pairingUrl: bytes("https://plex"),
    });
  }

  expect(loadPairing(model({ gatewayConnected: true }), 2, bytes(""), bytes("")).screen).toBe(
    "home",
  );
});

test("loadCatalog accepts a source and rejects empty responses", () => {
  const rows = [row(item(7), item(8))];
  const libraries = [
    { id: 2, sectionId: 20, title: bytes("Shows"), mediaType: 2, typeLabel: bytes("TV") },
  ];
  const before = model({ pairingLinked: true });
  const next = loadCatalog(before, bytes("Plex"), rows, libraries);

  expectTransition(next, before, {
    screen: "home",
    gatewayConnected: true,
    gatewayName: bytes("Plex"),
    rows: rows,
    libraries: libraries,
    rowIndex: 0,
    rowNumber: 1,
    selectedIndex: 0,
    selectedRatingKey: 107,
    selectedImageId: 207,
    selectedTitle: bytes("Item 7"),
    selectedDurationMs: 120_000,
    selectedViewOffsetMs: 7_000,
  });
  const emptyRows = loadCatalog(next, bytes("Other"), [], libraries);
  expect(emptyRows).toBe(next);
  expect(loadCatalog(next, bytes("Other"), [row()], libraries)).toBe(next);
});

test("browse transitions distinguish fresh, stale, empty, and cached failure", () => {
  const browseItems = [item(9), item(10)];
  const fresh = model({ screen: "browse", selectedLibraryId: 10, browseLoaded: false });
  const loaded = loadBrowse(fresh, 10, bytes("Films"), 7, 20, browseItems);
  expectTransition(loaded, fresh, {
    browseItems: browseItems,
    browseStart: 7,
    browsePendingStart: 7,
    browseTotal: 20,
    browseLoaded: true,
    browseFailed: false,
    selectedIndex: 0,
    selectedRatingKey: 109,
    selectedImageId: 209,
    selectedTitle: bytes("Item 9"),
    selectedLibraryTitle: bytes("Films"),
    selectedDurationMs: 120_000,
    selectedViewOffsetMs: 9_000,
    selectedFromBrowse: true,
    selectedFromSearch: false,
  });
  expect(loadBrowse(fresh, 11, bytes("Shows"), 0, 1, browseItems)).toBe(fresh);
  expect(loadBrowse(fresh, 10, bytes("Films"), 0, 1, [])).toBe(fresh);

  const noCacheBefore = model({ screen: "browse", browseItems: [] });
  const noCache = failBrowse(noCacheBefore);
  expectTransition(noCache, noCacheBefore, { browseLoaded: false, browseFailed: true });
  const cachedBefore = model({
    screen: "browse",
    browseItems: browseItems,
    browseStart: 7,
    browsePendingStart: 14,
  });
  const cached = failBrowse(cachedBefore);
  expectTransition(cached, cachedBefore, { browsePendingStart: 7, browseFailed: false });
  const browseOnHome = model({ screen: "home" });
  expect(failBrowse(browseOnHome)).toBe(browseOnHome);
});

test("search transitions preserve query ownership and stale guards", () => {
  const results = [item(11)];
  const pending = model({
    screen: "search_results",
    searchLoaded: false,
    searchQuery: bytes("old"),
  });
  const loaded = loadSearch(pending, bytes("new"), results);
  expectTransition(loaded, pending, {
    searchQuery: bytes("new"),
    searchItems: results,
    searchLoaded: true,
    searchFailed: false,
    selectedIndex: 0,
    selectedRatingKey: 111,
    selectedImageId: 211,
    selectedTitle: bytes("Item 11"),
    selectedDurationMs: 120_000,
    selectedViewOffsetMs: 11_000,
    selectedFromBrowse: false,
    selectedFromSearch: true,
  });
  const empty = loadSearch(pending, bytes("new"), []);
  expectTransition(empty, pending, {
    searchQuery: bytes("new"),
    searchItems: [],
    searchLoaded: true,
  });
  expect(loadSearch(pending, bytes(""), results)).toBe(pending);
  const searchScreen = model({ screen: "search" });
  expect(loadSearch(searchScreen, bytes("new"), results)).toBe(searchScreen);
  const failedBefore = model({ screen: "search_results", searchItems: results });
  const failed = failSearch(failedBefore);
  expectTransition(failed, failedBefore, {
    searchLoaded: false,
    searchFailed: true,
    searchItems: results,
  });
  const searchOnHome = model({ screen: "home" });
  expect(failSearch(searchOnHome)).toBe(searchOnHome);
});

test("details transitions accept matching metadata and reject stale replies", () => {
  const details = model({ screen: "details", selectedRatingKey: 42, detailsLoaded: false });
  const metadata = loadDetails(
    details,
    bytes("Episode"),
    bytes("Season 1"),
    bytes("Show"),
    bytes("Episode"),
    bytes("TV"),
    bytes("PG"),
    bytes("Facts"),
    bytes("Summary"),
    bytes("Drama"),
    bytes("Director"),
    true,
  );
  expectTransition(metadata, details, {
    selectedTitle: bytes("Episode"),
    detailsLoaded: true,
    detailsPlayable: true,
    detailsHierarchy: bytes("Show"),
    detailsSecondary: bytes("Season 1"),
    detailsType: bytes("Episode"),
    detailsLibrary: bytes("TV"),
    detailsContentRating: bytes("PG"),
    detailsFacts: bytes("Facts"),
    detailsSummary: bytes("Summary"),
    detailsGenres: bytes("Drama"),
    detailsDirectors: bytes("Director"),
  });
  const detailsOnHome = model({ screen: "home" });
  expect(
    loadDetails(
      detailsOnHome,
      bytes("x"),
      bytes(""),
      bytes(""),
      bytes(""),
      bytes(""),
      bytes(""),
      bytes(""),
      bytes(""),
      bytes(""),
      bytes(""),
      true,
    ),
  ).toBe(detailsOnHome);

  const children = [item(12)];
  const withChildren = loadDetailsChildren(metadata, 42, 4, 9, 2, 3, children);
  expectTransition(withChildren, metadata, {
    detailsChildren: children,
    detailsChildrenStart: 4,
    detailsChildrenPageNumber: 2,
    detailsChildrenPageCount: 3,
    detailsChildrenTotal: 9,
    detailsChildrenLoaded: true,
  });
  expect(loadDetailsChildren(metadata, 41, 0, 1, 1, 1, children)).toBe(metadata);
  const failed = failDetails(metadata);
  expectTransition(failed, metadata, {
    detailsLoaded: true,
    detailsPlayable: false,
    detailsSecondary: new Uint8Array(0),
    detailsType: bytes("Plex result"),
    detailsLibrary: metadata.gatewayName,
    detailsSummary: bytes(
      "Full metadata is not available for this result yet. Return and choose a playable library item.",
    ),
    detailsContentRating: new Uint8Array(0),
    detailsFacts: new Uint8Array(0),
    detailsGenres: new Uint8Array(0),
    detailsDirectors: new Uint8Array(0),
  });
  const detailsFailureOnHome = model({ screen: "home" });
  expect(failDetails(detailsFailureOnHome)).toBe(detailsFailureOnHome);
});

test("playback, subtitles, watched state, and navigation transitions are direct", () => {
  const pending = model({ screen: "player", playbackLoaded: false, playing: false });
  expectTransition(loadPlayback(pending), pending, { playbackLoaded: true, playing: true });
  const failedBefore = model({ screen: "player", playbackLoaded: false, playing: false });
  const failed = failPlayback(failedBefore);
  expectTransition(failed, failedBefore, {
    screen: "details",
    playbackLoaded: false,
    playing: false,
  });
  const playbackOnHome = model({ screen: "home" });
  expect(failPlayback(playbackOnHome)).toBe(playbackOnHome);

  const subtitleBefore = model();
  const streams = [
    { id: 1, label: bytes("English") },
    { id: 2, label: bytes("日本語") },
  ];
  const subtitles = loadSubtitleStreams(subtitleBefore, streams, 99);
  expectTransition(subtitles, subtitleBefore, {
    subtitleStreamCount: 2,
    subtitleStreams: streams,
    selectedSubtitleStream: 2,
  });

  const markPending = model({
    selectedViewOffsetMs: 30_000,
    selectedDurationMs: 120_000,
    markWatchedRequested: true,
  });
  const marked = completeMarkWatched(markPending, true);
  expectTransition(marked, markPending, {
    selectedViewOffsetMs: 0,
    rows: [
      row({ ...item(1), viewOffsetMs: 0, progressPercent: 0 }, item(2)),
      row(item(3), item(4)),
    ],
    markWatchedRequested: false,
    toastVisible: true,
    toastMessage: bytes("Marked as watched"),
  });
  const markFailed = completeMarkWatched(markPending, false);
  expectTransition(markFailed, markPending, {
    markWatchedRequested: false,
    toastVisible: true,
    toastMessage: bytes("Could not mark as watched. Check Plex."),
  });
  const markAlreadyComplete = model();
  expect(completeMarkWatched(markAlreadyComplete, true)).toBe(markAlreadyComplete);
  const withNavigation = model({ screen: "player", playbackNavigationRequest: 1 });
  expectTransition(clearPlaybackNavigationRequest(withNavigation), withNavigation, {
    playbackNavigationRequest: 0,
  });
  const navigationAlreadyClear = model();
  expect(clearPlaybackNavigationRequest(navigationAlreadyClear)).toBe(navigationAlreadyClear);
  const toastBefore = model();
  const toasted = showToast(toastBefore, bytes("Saved"));
  expectTransition(toasted, toastBefore, { toastVisible: true, toastMessage: bytes("Saved") });
  expectTransition(dismissToast(toasted), toasted, {
    toastVisible: false,
    toastMessage: new Uint8Array(0),
  });
});

test("Watch Together transitions cover lifecycle outcomes and idempotence", () => {
  const rooms = [{ id: 1, title: bytes("Room"), participantCount: 2 }];
  const inviteeList = [{ id: 1, userId: 8, title: bytes("Friend") }];
  const roomsBefore = model();
  const roomsLoaded = loadWatchTogetherRooms(roomsBefore, true, rooms);
  expectTransition(roomsLoaded, roomsBefore, {
    watchTogetherRooms: rooms,
    watchTogetherLoaded: true,
    watchTogetherAvailable: true,
    watchTogetherCreating: false,
    watchTogetherCreateFailed: false,
  });
  const unavailableBefore = model();
  expectTransition(loadWatchTogetherRooms(unavailableBefore, false, []), unavailableBefore, {
    watchTogetherLoaded: true,
    watchTogetherAvailable: false,
    watchTogetherRooms: [],
  });
  const inviteesBefore = model();
  expectTransition(loadWatchTogetherInvitees(inviteesBefore, true, inviteeList), inviteesBefore, {
    watchTogetherInvitees: inviteeList,
    watchTogetherInviteesLoaded: true,
    watchTogetherInviteesAvailable: true,
    watchTogetherInviteePage: 0,
  });
  const createFailureBefore = model({ watchTogetherCreating: true });
  expectTransition(failWatchTogetherCreate(createFailureBefore), createFailureBefore, {
    watchTogetherLoaded: true,
    watchTogetherAvailable: true,
    watchTogetherCreating: false,
    watchTogetherCreateFailed: true,
  });

  const joining = model({ watchTogetherJoining: true, watchTogetherPresentCount: 0 });
  expectTransition(completeWatchTogetherJoin(joining, true), joining, {
    watchTogetherJoining: false,
    watchTogetherConnected: true,
    watchTogetherJoinFailed: false,
    watchTogetherPresentCount: 1,
  });
  expectTransition(completeWatchTogetherJoin(joining, false), joining, {
    watchTogetherJoining: false,
    watchTogetherConnected: false,
    watchTogetherJoinFailed: true,
    watchTogetherPresentCount: 0,
  });
  const present = model({ watchTogetherConnected: true, watchTogetherPresentCount: 2 });
  expect(updateWatchTogetherPresence(present, true, 2)).toBe(present);
  expectTransition(updateWatchTogetherPresence(present, false, 0), present, {
    watchTogetherConnected: false,
    watchTogetherPresentCount: 0,
    watchTogetherJoinFailed: false,
  });

  const leaving = model({ watchTogetherLeaveRequested: true, watchTogetherHost: true });
  expectTransition(completeWatchTogetherLeave(leaving), leaving, {
    watchTogetherHost: false,
    watchTogetherLeaveRequested: false,
  });
  const leaveAlreadyComplete = model();
  expect(completeWatchTogetherLeave(leaveAlreadyComplete)).toBe(leaveAlreadyComplete);
  const reconnecting = model({ watchTogetherReconnectRequested: true });
  expectTransition(completeWatchTogetherReconnect(reconnecting), reconnecting, {
    watchTogetherReconnectRequested: false,
  });
  const reconnectAlreadyComplete = model();
  expect(completeWatchTogetherReconnect(reconnectAlreadyComplete)).toBe(reconnectAlreadyComplete);
  const host = model({ watchTogetherHost: true });
  expect(setWatchTogetherHost(host, true)).toBe(host);
  expectTransition(setWatchTogetherHost(host, false), host, { watchTogetherHost: false });
  const disbanding = model({ watchTogetherDisbandRequested: true, watchTogetherHost: true });
  expectTransition(completeWatchTogetherDisband(disbanding, true), disbanding, {
    watchTogetherHost: false,
    watchTogetherDisbandRequested: false,
    watchTogetherDisbandFailed: false,
  });
  expectTransition(completeWatchTogetherDisband(disbanding, false), disbanding, {
    watchTogetherHost: true,
    watchTogetherDisbandRequested: false,
    watchTogetherDisbandFailed: true,
  });
  const disbandAlreadyComplete = model();
  expect(completeWatchTogetherDisband(disbandAlreadyComplete, true)).toBe(disbandAlreadyComplete);
});

test("catalog preview and carousel transitions guard bounds", () => {
  const items = Array.from({ length: 10 }, (_, index) => item(index));
  const start = model({ rows: [row(...items)], selectedIndex: 0, homeCarouselStart: 0 });
  const previewed = previewCatalogItem(start, 4);
  expectTransition(previewed, start, {
    selectedIndex: 4,
    selectedRatingKey: 104,
    selectedImageId: 204,
    selectedTitle: bytes("Item 4"),
    selectedDurationMs: 120_000,
    selectedViewOffsetMs: 4_000,
  });
  expect(previewCatalogItem(start, -1)).toBe(start);
  expect(previewCatalogItem(start, 10)).toBe(start);
  const next = moveHomeCarousel(start, 1);
  expectTransition(next, start, {
    homeCarouselStart: 1,
    selectedIndex: 7,
    selectedRatingKey: 107,
    selectedImageId: 207,
    selectedTitle: bytes("Item 7"),
    selectedDurationMs: 120_000,
    selectedViewOffsetMs: 7_000,
  });
  const previous = moveHomeCarousel(next, -1);
  expectTransition(previous, next, {
    homeCarouselStart: 0,
    selectedIndex: 0,
    selectedRatingKey: 100,
    selectedImageId: 200,
    selectedTitle: bytes("Item 0"),
    selectedDurationMs: 120_000,
    selectedViewOffsetMs: 0,
  });
  const nearEnd = model({ rows: [row(...items)], homeCarouselStart: 2, selectedIndex: 2 });
  const end = moveHomeCarousel(nearEnd, 1);
  expectTransition(end, nearEnd, {
    homeCarouselStart: 3,
    selectedIndex: 9,
    selectedRatingKey: 109,
    selectedImageId: 209,
    selectedTitle: bytes("Item 9"),
    selectedDurationMs: 120_000,
    selectedViewOffsetMs: 9_000,
  });
  expect(moveHomeCarousel(start, -1)).toBe(start);
  expect(moveHomeCarousel(end, 1)).toBe(end);
});

test("playback transitions own pause, navigation, and advance", () => {
  const player = model({
    screen: "player",
    playbackLoaded: true,
    playing: true,
    playbackOffsetMs: 30_000,
    selectedDurationMs: 120_000,
    selectedWatchTogetherRoomIndex: 0,
    watchTogetherRooms: [{ id: 1, title: bytes("Room"), participantCount: 2 }],
  });
  expectTransition(transitionPlayback(player, { kind: "set_paused", paused: true }), player, {
    playing: false,
  });
  expect(transitionPlayback(player, { kind: "set_paused", paused: false })).toBe(player);
  const playbackPauseOnDetails = model({ screen: "details" });
  expect(transitionPlayback(playbackPauseOnDetails, { kind: "set_paused", paused: true })).toBe(
    playbackPauseOnDetails,
  );

  const navigated = transitionPlayback(player, {
    kind: "navigate",
    ratingKey: 55,
    title: bytes("Next"),
    secondary: bytes("Season 2"),
    hierarchy: bytes("Show"),
    durationMs: 90_000,
  });
  expectTransition(navigated, player, {
    selectedRatingKey: 55,
    selectedTitle: bytes("Next"),
    selectedDurationMs: 90_000,
    selectedViewOffsetMs: 0,
    playbackOffsetMs: 0,
    playbackLoaded: false,
    playing: false,
    playbackNavigationRequest: 0,
    detailsLoaded: false,
    detailsSecondary: bytes("Season 2"),
    detailsHierarchy: bytes("Show"),
    detailsChildren: [],
    detailsChildrenStart: 0,
    detailsChildrenPageNumber: 1,
    detailsChildrenPageCount: 1,
    detailsChildrenTotal: 0,
    detailsChildrenLoaded: false,
  });
  expect(
    transitionPlayback(player, {
      kind: "navigate",
      ratingKey: 0,
      title: bytes("Next"),
      secondary: bytes(""),
      hierarchy: bytes(""),
      durationMs: 90_000,
    }),
  ).toBe(player);
  expect(
    transitionPlayback(player, {
      kind: "navigate",
      ratingKey: 55,
      title: bytes(""),
      secondary: bytes(""),
      hierarchy: bytes(""),
      durationMs: 90_000,
    }),
  ).toBe(player);

  const advanced = transitionPlayback(player, {
    kind: "advance",
    ratingKey: 56,
    title: bytes("Following"),
    durationMs: 100_000,
  });
  expectTransition(advanced, player, {
    selectedRatingKey: 56,
    selectedTitle: bytes("Following"),
    selectedDurationMs: 100_000,
    selectedViewOffsetMs: 0,
    playbackOffsetMs: 0,
    playbackLoaded: false,
    playing: false,
    detailsLoaded: false,
    detailsChildren: [],
    detailsChildrenStart: 0,
    detailsChildrenPageNumber: 1,
    detailsChildrenPageCount: 1,
    detailsChildrenTotal: 0,
    detailsChildrenLoaded: false,
  });
  expect(
    transitionPlayback(player, {
      kind: "advance",
      ratingKey: 56,
      title: bytes("Following"),
      durationMs: 1,
    }),
  ).toBe(player);
});

test("Watch Together playback transition owns its valid room identity", () => {
  const startBefore = model({
    watchTogetherRooms: [{ id: 1, title: bytes("Room"), participantCount: 2 }],
    selectedFromBrowse: true,
    selectedFromSearch: true,
    watchTogetherLeaveRequested: true,
    watchTogetherReconnectRequested: true,
    watchTogetherDisbandRequested: true,
  });
  const started = transitionPlayback(startBefore, {
    kind: "start_watch_together",
    roomIndex: 0,
    ratingKey: 57,
    title: bytes("Shared"),
    durationMs: 80_000,
    offsetMs: 5_000,
  });
  expectTransition(started, startBefore, {
    screen: "player",
    selectedWatchTogetherRoomIndex: 0,
    selectedRatingKey: 57,
    selectedTitle: bytes("Shared"),
    selectedDurationMs: 80_000,
    selectedViewOffsetMs: 5_000,
    selectedFromBrowse: false,
    selectedFromSearch: false,
    playbackOffsetMs: 5_000,
    playbackLoaded: true,
    playing: true,
    watchTogetherActive: true,
    watchTogetherLeaveRequested: false,
    watchTogetherReconnectRequested: false,
    watchTogetherDisbandRequested: false,
  });
  const invalidStart = model({ watchTogetherRooms: [] });
  expect(
    transitionPlayback(invalidStart, {
      kind: "start_watch_together",
      roomIndex: 0,
      ratingKey: 57,
      title: bytes("Shared"),
      durationMs: 80_000,
      offsetMs: 0,
    }),
  ).toBe(invalidStart);
});

test("boot diagnostics transition and clear toast without changing unrelated state", () => {
  const starting = model({ gatewayName: bytes("Gateway") });
  const diagnostics = loadBootDiagnostics(starting, bytes("boot warning"));
  expectTransition(diagnostics, starting, {
    gatewayName: bytes("Gateway"),
    bootDiagnostics: bytes("boot warning"),
  });
  const toast = showToast(diagnostics, bytes("Ready"));
  const cleared = dismissToast(toast);
  expectTransition(cleared, toast, {
    bootDiagnostics: bytes("boot warning"),
    toastVisible: false,
    toastMessage: new Uint8Array(0),
  });
});
