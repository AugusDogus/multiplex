import { asciiBytes } from "@native-sdk/core";

export type Screen =
  | "pairing"
  | "home"
  | "libraries"
  | "browse"
  | "search"
  | "search_results"
  | "watch_together_invite"
  | "watch_together"
  | "watch_together_room"
  | "details"
  | "player";

export interface CatalogItem {
  readonly id: number;
  readonly ratingKey: number;
  readonly title: Uint8Array;
  readonly subtitle: Uint8Array;
  readonly secondary: Uint8Array;
  readonly hierarchy: Uint8Array;
  readonly hasHierarchy: boolean;
  readonly imageId: number;
  readonly durationMs: number;
  readonly viewOffsetMs: number;
  readonly progressPercent: number;
}

export interface CatalogRow {
  readonly id: number;
  readonly title: Uint8Array;
  readonly items: readonly CatalogItem[];
}

export interface LibrarySection {
  readonly id: number;
  readonly sectionId: number;
  readonly title: Uint8Array;
  readonly mediaType: number;
  readonly typeLabel: Uint8Array;
}

export interface KeyboardKey {
  readonly id: number;
  readonly label: Uint8Array;
  readonly value: number;
}

export interface SubtitleStream {
  readonly id: number;
  readonly label: Uint8Array;
}

export interface WatchTogetherRoom {
  readonly id: number;
  readonly title: Uint8Array;
  readonly participantCount: number;
}

export interface WatchTogetherInvitee {
  readonly id: number;
  readonly userId: number;
  readonly title: Uint8Array;
}

export interface Model {
  readonly screen: Screen;
  readonly gatewayConnected: boolean;
  readonly gatewayName: Uint8Array;
  readonly pairingEnabled: boolean;
  readonly pairingConnecting: boolean;
  readonly pairingWaiting: boolean;
  readonly pairingLinked: boolean;
  readonly pairingUnavailable: boolean;
  readonly pairingCode: Uint8Array;
  readonly pairingUrl: Uint8Array;
  readonly rows: readonly CatalogRow[];
  readonly libraries: readonly LibrarySection[];
  readonly rowIndex: number;
  readonly rowNumber: number;
  readonly selectedIndex: number;
  readonly selectedRatingKey: number;
  readonly selectedImageId: number;
  readonly selectedTitle: Uint8Array;
  readonly selectedDurationMs: number;
  readonly selectedViewOffsetMs: number;
  readonly selectedFromBrowse: boolean;
  readonly selectedLibraryId: number;
  readonly selectedLibraryTitle: Uint8Array;
  readonly browseItems: readonly CatalogItem[];
  readonly browseStart: number;
  readonly browsePageNumber: number;
  readonly browsePageCount: number;
  readonly browseTotal: number;
  readonly browseLoaded: boolean;
  readonly browseFailed: boolean;
  readonly searchQuery: Uint8Array;
  readonly searchCursor: number;
  readonly searchItems: readonly CatalogItem[];
  readonly searchLoaded: boolean;
  readonly searchFailed: boolean;
  readonly selectedFromSearch: boolean;
  readonly watchTogetherRooms: readonly WatchTogetherRoom[];
  readonly watchTogetherInvitees: readonly WatchTogetherInvitee[];
  readonly watchTogetherInviteesLoaded: boolean;
  readonly watchTogetherInviteesAvailable: boolean;
  readonly watchTogetherInviteePage: number;
  readonly selectedWatchTogetherInviteeId: number;
  readonly watchTogetherLoaded: boolean;
  readonly watchTogetherAvailable: boolean;
  readonly watchTogetherCreating: boolean;
  readonly watchTogetherCreateFailed: boolean;
  readonly selectedWatchTogetherRoomIndex: number;
  readonly watchTogetherJoining: boolean;
  readonly watchTogetherConnected: boolean;
  readonly watchTogetherJoinFailed: boolean;
  readonly watchTogetherActive: boolean;
  readonly watchTogetherPresentCount: number;
  readonly watchTogetherHost: boolean;
  readonly watchTogetherLeaveRequested: boolean;
  readonly watchTogetherReconnectRequested: boolean;
  readonly watchTogetherDisbandRequested: boolean;
  readonly watchTogetherDisbandFailed: boolean;
  readonly detailsLoaded: boolean;
  readonly detailsPlayable: boolean;
  readonly detailsHierarchy: Uint8Array;
  readonly detailsSecondary: Uint8Array;
  readonly detailsType: Uint8Array;
  readonly detailsLibrary: Uint8Array;
  readonly detailsContentRating: Uint8Array;
  readonly detailsFacts: Uint8Array;
  readonly detailsSummary: Uint8Array;
  readonly detailsGenres: Uint8Array;
  readonly detailsDirectors: Uint8Array;
  readonly detailsChildren: readonly CatalogItem[];
  readonly detailsChildrenStart: number;
  readonly detailsChildrenPageNumber: number;
  readonly detailsChildrenPageCount: number;
  readonly detailsChildrenTotal: number;
  readonly detailsChildrenLoaded: boolean;
  readonly detailsHistory: readonly CatalogItem[];
  readonly playbackOffsetMs: number;
  readonly videoSurface: number;
  readonly playbackLoaded: boolean;
  readonly playing: boolean;
  readonly subtitleStreamCount: number;
  readonly subtitleStreams: readonly SubtitleStream[];
  readonly selectedSubtitleStream: number;
  readonly markWatchedRequested: boolean;
  readonly toastVisible: boolean;
  readonly toastMessage: Uint8Array;
  readonly startMenuOpen: boolean;
  readonly playerSettingsOpen: boolean;
  readonly playbackNavigationRequest: number;
}

export type Msg =
  | { readonly kind: "connect_demo" }
  | { readonly kind: "previous_row" }
  | { readonly kind: "next_row" }
  | { readonly kind: "open_libraries" }
  | { readonly kind: "open_library"; readonly index: number }
  | { readonly kind: "browse_previous" }
  | { readonly kind: "browse_next" }
  | { readonly kind: "open_search" }
  | { readonly kind: "search_key"; readonly index: number }
  | { readonly kind: "search_delete" }
  | { readonly kind: "search_cursor_left" }
  | { readonly kind: "search_cursor_right" }
  | { readonly kind: "search_submit" }
  | { readonly kind: "open_watch_together" }
  | { readonly kind: "open_start_menu" }
  | { readonly kind: "close_start_menu" }
  | { readonly kind: "start_menu_play" }
  | { readonly kind: "start_menu_mark_watched" }
  | { readonly kind: "start_menu_create_watch_together" }
  | { readonly kind: "start_menu_watch_together" }
  | { readonly kind: "start_menu_libraries" }
  | { readonly kind: "start_menu_search" }
  | { readonly kind: "create_watch_together" }
  | { readonly kind: "watch_together_invitees_previous" }
  | { readonly kind: "watch_together_invitees_next" }
  | { readonly kind: "invite_watch_together"; readonly index: number }
  | { readonly kind: "join_watch_together"; readonly index: number }
  | { readonly kind: "leave_watch_together" }
  | { readonly kind: "reconnect_watch_together" }
  | { readonly kind: "disband_watch_together" }
  | { readonly kind: "open_item"; readonly index: number }
  | { readonly kind: "open_details_child"; readonly index: number }
  | { readonly kind: "details_children_previous" }
  | { readonly kind: "details_children_next" }
  | { readonly kind: "play" }
  | { readonly kind: "mark_watched" }
  | { readonly kind: "seek_backward" }
  | { readonly kind: "seek_forward" }
  | { readonly kind: "open_player_settings" }
  | { readonly kind: "close_player_settings" }
  | { readonly kind: "stop_playback" }
  | { readonly kind: "play_previous" }
  | { readonly kind: "play_next" }
  | { readonly kind: "sync_playback"; readonly positionMs: number }
  | { readonly kind: "continue_playback"; readonly positionMs: number }
  | { readonly kind: "complete_playback" }
  | { readonly kind: "toggle_playback" }
  | { readonly kind: "cycle_subtitles" }
  | { readonly kind: "back" };

const demoItems: readonly CatalogItem[] = [
  {
    id: 0,
    ratingKey: 1,
    title: asciiBytes("The Fifth Element"),
    subtitle: asciiBytes("Movie"),
    secondary: asciiBytes("Movie"),
    hierarchy: new Uint8Array(0),
    hasHierarchy: false,
    imageId: 1,
    durationMs: 0,
    viewOffsetMs: 0,
    progressPercent: 0,
  },
  {
    id: 1,
    ratingKey: 2,
    title: asciiBytes("Alien"),
    subtitle: asciiBytes("Movie"),
    secondary: asciiBytes("Movie"),
    hierarchy: new Uint8Array(0),
    hasHierarchy: false,
    imageId: 2,
    durationMs: 0,
    viewOffsetMs: 0,
    progressPercent: 0,
  },
  {
    id: 2,
    ratingKey: 3,
    title: asciiBytes("Spirited Away"),
    subtitle: asciiBytes("Movie"),
    secondary: asciiBytes("Movie"),
    hierarchy: new Uint8Array(0),
    hasHierarchy: false,
    imageId: 3,
    durationMs: 0,
    viewOffsetMs: 0,
    progressPercent: 0,
  },
  {
    id: 3,
    ratingKey: 4,
    title: asciiBytes("Twin Peaks"),
    subtitle: asciiBytes("TV Show"),
    secondary: asciiBytes("TV Show"),
    hierarchy: new Uint8Array(0),
    hasHierarchy: false,
    imageId: 4,
    durationMs: 0,
    viewOffsetMs: 0,
    progressPercent: 0,
  },
];

const demoRows: readonly CatalogRow[] = [
  { id: 1, title: asciiBytes("Continue Watching"), items: demoItems },
];

const demoLibraries: readonly LibrarySection[] = [
  {
    id: 0,
    sectionId: 1,
    title: asciiBytes("Movies"),
    mediaType: 1,
    typeLabel: asciiBytes("Movies"),
  },
];

const keyboardKeys: readonly KeyboardKey[] = [
  { id: 0, label: asciiBytes("Q"), value: 81 },
  { id: 1, label: asciiBytes("W"), value: 87 },
  { id: 2, label: asciiBytes("E"), value: 69 },
  { id: 3, label: asciiBytes("R"), value: 82 },
  { id: 4, label: asciiBytes("T"), value: 84 },
  { id: 5, label: asciiBytes("Y"), value: 89 },
  { id: 6, label: asciiBytes("U"), value: 85 },
  { id: 7, label: asciiBytes("I"), value: 73 },
  { id: 8, label: asciiBytes("O"), value: 79 },
  { id: 9, label: asciiBytes("P"), value: 80 },
  { id: 10, label: asciiBytes("A"), value: 65 },
  { id: 11, label: asciiBytes("S"), value: 83 },
  { id: 12, label: asciiBytes("D"), value: 68 },
  { id: 13, label: asciiBytes("F"), value: 70 },
  { id: 14, label: asciiBytes("G"), value: 71 },
  { id: 15, label: asciiBytes("H"), value: 72 },
  { id: 16, label: asciiBytes("J"), value: 74 },
  { id: 17, label: asciiBytes("K"), value: 75 },
  { id: 18, label: asciiBytes("L"), value: 76 },
  { id: 19, label: asciiBytes("Z"), value: 90 },
  { id: 20, label: asciiBytes("X"), value: 88 },
  { id: 21, label: asciiBytes("C"), value: 67 },
  { id: 22, label: asciiBytes("V"), value: 86 },
  { id: 23, label: asciiBytes("B"), value: 66 },
  { id: 24, label: asciiBytes("N"), value: 78 },
  { id: 25, label: asciiBytes("M"), value: 77 },
];

const keyboardRowOneKeys: readonly KeyboardKey[] = [
  { id: 0, label: asciiBytes("Q"), value: 81 },
  { id: 1, label: asciiBytes("W"), value: 87 },
  { id: 2, label: asciiBytes("E"), value: 69 },
  { id: 3, label: asciiBytes("R"), value: 82 },
  { id: 4, label: asciiBytes("T"), value: 84 },
  { id: 5, label: asciiBytes("Y"), value: 89 },
  { id: 6, label: asciiBytes("U"), value: 85 },
  { id: 7, label: asciiBytes("I"), value: 73 },
  { id: 8, label: asciiBytes("O"), value: 79 },
  { id: 9, label: asciiBytes("P"), value: 80 },
];

const keyboardRowTwoKeys: readonly KeyboardKey[] = [
  { id: 10, label: asciiBytes("A"), value: 65 },
  { id: 11, label: asciiBytes("S"), value: 83 },
  { id: 12, label: asciiBytes("D"), value: 68 },
  { id: 13, label: asciiBytes("F"), value: 70 },
  { id: 14, label: asciiBytes("G"), value: 71 },
  { id: 15, label: asciiBytes("H"), value: 72 },
  { id: 16, label: asciiBytes("J"), value: 74 },
  { id: 17, label: asciiBytes("K"), value: 75 },
  { id: 18, label: asciiBytes("L"), value: 76 },
];

const keyboardRowThreeKeys: readonly KeyboardKey[] = [
  { id: 19, label: asciiBytes("Z"), value: 90 },
  { id: 20, label: asciiBytes("X"), value: 88 },
  { id: 21, label: asciiBytes("C"), value: 67 },
  { id: 22, label: asciiBytes("V"), value: 86 },
  { id: 23, label: asciiBytes("B"), value: 66 },
  { id: 24, label: asciiBytes("N"), value: 78 },
  { id: 25, label: asciiBytes("M"), value: 77 },
];

const searchPlaceholder = asciiBytes("Search");
const pageLibraries = asciiBytes("Libraries");
const pageSearch = asciiBytes("Search");
const pageSearchResults = asciiBytes("Search results");
const pageWatchTogether = asciiBytes("Watch Together");
const pageInvite = asciiBytes("Invite a friend");
const playLabel = asciiBytes("Play");
const resumeLabel = asciiBytes("Resume");
const unavailableDetailsType = asciiBytes("Plex result");
const unavailableDetailsSummary = asciiBytes(
  "Full metadata is not available for this result yet. Return and choose a playable library item.",
);

export function initialModel(): Model {
  return {
    screen: "pairing",
    gatewayConnected: false,
    gatewayName: asciiBytes("Demo library"),
    pairingEnabled: false,
    pairingConnecting: false,
    pairingWaiting: false,
    pairingLinked: false,
    pairingUnavailable: false,
    pairingCode: new Uint8Array(0),
    pairingUrl: new Uint8Array(0),
    rows: demoRows,
    libraries: demoLibraries,
    rowIndex: 0,
    rowNumber: 1,
    selectedIndex: 0,
    selectedRatingKey: demoItems[0].ratingKey,
    selectedImageId: demoItems[0].imageId,
    selectedTitle: demoItems[0].title,
    selectedDurationMs: 0,
    selectedViewOffsetMs: 0,
    selectedFromBrowse: false,
    selectedLibraryId: 1,
    selectedLibraryTitle: demoLibraries[0].title,
    browseItems: demoItems,
    browseStart: 0,
    browsePageNumber: 1,
    browsePageCount: 1,
    browseTotal: demoItems.length,
    browseLoaded: true,
    browseFailed: false,
    searchQuery: new Uint8Array(0),
    searchCursor: 0,
    searchItems: [],
    searchLoaded: true,
    searchFailed: false,
    selectedFromSearch: false,
    watchTogetherRooms: [],
    watchTogetherInvitees: [],
    watchTogetherInviteesLoaded: false,
    watchTogetherInviteesAvailable: false,
    watchTogetherInviteePage: 0,
    selectedWatchTogetherInviteeId: 0,
    watchTogetherLoaded: false,
    watchTogetherAvailable: false,
    watchTogetherCreating: false,
    watchTogetherCreateFailed: false,
    selectedWatchTogetherRoomIndex: 0,
    watchTogetherJoining: false,
    watchTogetherConnected: false,
    watchTogetherJoinFailed: false,
    watchTogetherActive: false,
    watchTogetherPresentCount: 0,
    watchTogetherHost: false,
    watchTogetherLeaveRequested: false,
    watchTogetherReconnectRequested: false,
    watchTogetherDisbandRequested: false,
    watchTogetherDisbandFailed: false,
    detailsLoaded: true,
    detailsPlayable: true,
    detailsHierarchy: new Uint8Array(0),
    detailsSecondary: asciiBytes("Native SDK media prototype"),
    detailsType: asciiBytes("Movie"),
    detailsLibrary: asciiBytes("Demo library"),
    detailsContentRating: new Uint8Array(0),
    detailsFacts: new Uint8Array(0),
    detailsSummary: asciiBytes(
      "Console-native media details rendered by the shared Native SDK view.",
    ),
    detailsGenres: new Uint8Array(0),
    detailsDirectors: new Uint8Array(0),
    detailsChildren: [],
    detailsChildrenStart: 0,
    detailsChildrenPageNumber: 1,
    detailsChildrenPageCount: 1,
    detailsChildrenTotal: 0,
    detailsChildrenLoaded: true,
    detailsHistory: [],
    playbackOffsetMs: 0,
    videoSurface: 0,
    playbackLoaded: true,
    playing: false,
    subtitleStreamCount: 0,
    subtitleStreams: [],
    selectedSubtitleStream: 0,
    markWatchedRequested: false,
    toastVisible: false,
    toastMessage: new Uint8Array(0),
    startMenuOpen: false,
    playerSettingsOpen: false,
    playbackNavigationRequest: 0,
  };
}

export function loadCatalog(
  model: Model,
  gatewayName: Uint8Array,
  rows: readonly CatalogRow[],
  libraries: readonly LibrarySection[],
): Model {
  if (rows.length === 0 || rows[0].items.length === 0) return model;
  return {
    ...model,
    screen: model.pairingLinked ? "home" : model.screen,
    gatewayConnected: true,
    gatewayName: gatewayName,
    rows: rows,
    libraries: libraries.length === 0 ? model.libraries : libraries,
    rowIndex: 0,
    rowNumber: 1,
    selectedIndex: 0,
    selectedRatingKey: rows[0].items[0].ratingKey,
    selectedImageId: rows[0].items[0].imageId,
    selectedTitle: rows[0].items[0].title,
    selectedDurationMs: rows[0].items[0].durationMs,
    selectedViewOffsetMs: rows[0].items[0].viewOffsetMs,
  };
}

export function loadPairing(
  model: Model,
  status: number,
  code: Uint8Array,
  linkUrl: Uint8Array,
): Model {
  const linked = status === 2;
  return {
    ...model,
    screen: linked && model.gatewayConnected ? "home" : "pairing",
    pairingEnabled: true,
    pairingConnecting: status === 4,
    pairingWaiting: status === 1,
    pairingLinked: linked,
    pairingUnavailable: status === 3,
    pairingCode: code,
    pairingUrl: linkUrl,
  };
}

export function loadBrowse(
  model: Model,
  sectionId: number,
  title: Uint8Array,
  start: number,
  total: number,
  pageNumber: number,
  pageCount: number,
  items: readonly CatalogItem[],
): Model {
  if (sectionId !== model.selectedLibraryId || items.length === 0) return model;
  return previewCatalogItem(
    {
      ...model,
      selectedLibraryTitle: title,
      browseItems: items,
      browseStart: start,
      browsePageNumber: pageNumber,
      browsePageCount: pageCount,
      browseTotal: total,
      browseLoaded: true,
      browseFailed: false,
    },
    0,
  );
}

export function failBrowse(model: Model): Model {
  return model.screen === "browse" ? { ...model, browseLoaded: false, browseFailed: true } : model;
}

export function loadSearch(model: Model, query: Uint8Array, items: readonly CatalogItem[]): Model {
  if (model.screen !== "search_results" || query.length === 0) return model;
  if (items.length === 0) {
    return {
      ...model,
      searchQuery: query,
      searchItems: items,
      searchLoaded: true,
      searchFailed: false,
    };
  }
  return previewCatalogItem(
    {
      ...model,
      searchQuery: query,
      searchItems: items,
      searchLoaded: true,
      searchFailed: false,
    },
    0,
  );
}

export function failSearch(model: Model): Model {
  return model.screen === "search_results"
    ? { ...model, searchLoaded: false, searchFailed: true }
    : model;
}

export function loadWatchTogetherRooms(
  model: Model,
  available: boolean,
  rooms: readonly WatchTogetherRoom[],
): Model {
  return {
    ...model,
    watchTogetherRooms: rooms,
    watchTogetherLoaded: true,
    watchTogetherAvailable: available,
    watchTogetherCreating: false,
    watchTogetherCreateFailed: false,
  };
}

export function loadWatchTogetherInvitees(
  model: Model,
  available: boolean,
  invitees: readonly WatchTogetherInvitee[],
): Model {
  return {
    ...model,
    watchTogetherInvitees: invitees,
    watchTogetherInviteesLoaded: true,
    watchTogetherInviteesAvailable: available,
    watchTogetherInviteePage: 0,
  };
}

export function failWatchTogetherCreate(model: Model): Model {
  return {
    ...model,
    watchTogetherLoaded: true,
    watchTogetherAvailable: true,
    watchTogetherCreating: false,
    watchTogetherCreateFailed: true,
  };
}

export function completeWatchTogetherJoin(model: Model, connected: boolean): Model {
  return {
    ...model,
    watchTogetherJoining: false,
    watchTogetherConnected: connected,
    watchTogetherJoinFailed: !connected,
    watchTogetherPresentCount: connected ? Math.max(1, model.watchTogetherPresentCount) : 0,
  };
}

export function updateWatchTogetherPresence(
  model: Model,
  connected: boolean,
  presentCount: number,
): Model {
  const normalizedCount = connected ? Math.max(1, presentCount) : 0;
  if (
    model.watchTogetherConnected === connected &&
    model.watchTogetherPresentCount === normalizedCount
  )
    return model;
  return {
    ...model,
    watchTogetherConnected: connected,
    watchTogetherPresentCount: normalizedCount,
    watchTogetherJoinFailed: false,
  };
}

export function completeWatchTogetherLeave(model: Model): Model {
  return model.watchTogetherLeaveRequested
    ? { ...model, watchTogetherHost: false, watchTogetherLeaveRequested: false }
    : model;
}

export function completeWatchTogetherReconnect(model: Model): Model {
  return model.watchTogetherReconnectRequested
    ? { ...model, watchTogetherReconnectRequested: false }
    : model;
}

export function setWatchTogetherHost(model: Model, host: boolean): Model {
  return model.watchTogetherHost === host ? model : { ...model, watchTogetherHost: host };
}

export function completeWatchTogetherDisband(model: Model, deleted: boolean): Model {
  return model.watchTogetherDisbandRequested
    ? {
        ...model,
        watchTogetherHost: deleted ? false : model.watchTogetherHost,
        watchTogetherDisbandRequested: false,
        watchTogetherDisbandFailed: !deleted,
      }
    : model;
}

function leaveWatchTogether(model: Model): Model {
  if (!model.watchTogetherActive) return model;
  const progressed = commitSelectedProgress(model);
  return {
    ...progressed,
    screen: "watch_together",
    playbackLoaded: false,
    playing: false,
    watchTogetherJoining: false,
    watchTogetherConnected: false,
    watchTogetherJoinFailed: false,
    watchTogetherActive: false,
    watchTogetherPresentCount: 0,
    watchTogetherLeaveRequested: true,
    watchTogetherReconnectRequested: false,
  };
}

function disbandWatchTogether(model: Model): Model {
  if (!model.watchTogetherActive || !model.watchTogetherHost) return model;
  const left = leaveWatchTogether(model);
  return {
    ...left,
    watchTogetherLeaveRequested: false,
    watchTogetherDisbandRequested: true,
    watchTogetherDisbandFailed: false,
  };
}

export function loadDetails(
  model: Model,
  title: Uint8Array,
  secondary: Uint8Array,
  hierarchy: Uint8Array,
  mediaType: Uint8Array,
  library: Uint8Array,
  contentRating: Uint8Array,
  facts: Uint8Array,
  summary: Uint8Array,
  genres: Uint8Array,
  directors: Uint8Array,
  playable: boolean,
): Model {
  if (model.screen !== "details") return model;
  return {
    ...model,
    selectedTitle: title,
    detailsLoaded: true,
    detailsPlayable: playable,
    detailsHierarchy: hierarchy,
    detailsSecondary: secondary,
    detailsType: mediaType,
    detailsLibrary: library,
    detailsContentRating: contentRating,
    detailsFacts: facts,
    detailsSummary: summary,
    detailsGenres: genres,
    detailsDirectors: directors,
  };
}

export function loadDetailsChildren(
  model: Model,
  ratingKey: number,
  start: number,
  total: number,
  pageNumber: number,
  pageCount: number,
  children: readonly CatalogItem[],
): Model {
  if (model.screen !== "details" || ratingKey !== model.selectedRatingKey) return model;
  return {
    ...model,
    detailsChildren: children,
    detailsChildrenStart: start,
    detailsChildrenPageNumber: pageNumber,
    detailsChildrenPageCount: pageCount,
    detailsChildrenTotal: total,
    detailsChildrenLoaded: true,
  };
}

export function failDetails(model: Model): Model {
  if (model.screen !== "details") return model;
  return {
    ...model,
    detailsLoaded: true,
    detailsPlayable: false,
    detailsSecondary: new Uint8Array(0),
    detailsType: unavailableDetailsType,
    detailsLibrary: model.gatewayName,
    detailsContentRating: new Uint8Array(0),
    detailsFacts: new Uint8Array(0),
    detailsSummary: unavailableDetailsSummary,
    detailsGenres: new Uint8Array(0),
    detailsDirectors: new Uint8Array(0),
  };
}

export function loadPlayback(model: Model): Model {
  if (model.screen !== "player") return model;
  return { ...model, playbackLoaded: true, playing: true };
}

export function failPlayback(model: Model): Model {
  if (model.screen !== "player") return model;
  return {
    ...model,
    screen: "details",
    playbackLoaded: false,
    playing: false,
  };
}

export function playbackToggleIcon(model: Model): Uint8Array {
  return model.playing ? asciiBytes("pause") : asciiBytes("play");
}

export function loadSubtitleStreams(
  model: Model,
  streams: readonly SubtitleStream[],
  selected: number,
): Model {
  const boundedCount = streams.length;
  return {
    ...model,
    subtitleStreamCount: boundedCount,
    subtitleStreams: streams,
    selectedSubtitleStream: Math.min(Math.max(0, selected), boundedCount),
  };
}

export function subtitlesAvailable(model: Model): boolean {
  return model.subtitleStreamCount > 0;
}

export function subtitlesEnabled(model: Model): boolean {
  return model.selectedSubtitleStream > 0;
}

export function selectedSubtitleLabel(model: Model): Uint8Array {
  if (model.selectedSubtitleStream <= 0 || model.selectedSubtitleStream > model.subtitleStreams.length)
    return asciiBytes("Off");
  return model.subtitleStreams[model.selectedSubtitleStream - 1].label;
}

export function playbackSubtitleSelection(model: Model): number {
  return model.screen === "player" ? model.selectedSubtitleStream : 0;
}

export function markWatchedRequestRatingKey(model: Model): number {
  return model.markWatchedRequested ? model.selectedRatingKey : 0;
}

export function completeMarkWatched(model: Model, succeeded: boolean): Model {
  if (!model.markWatchedRequested) return model;
  if (!succeeded)
    return {
      ...model,
      markWatchedRequested: false,
      toastVisible: true,
      toastMessage: asciiBytes("Could not mark as watched. Check Plex."),
    };
  const cleared = commitSelectedProgressAt(model, 0);
  return {
    ...cleared,
    markWatchedRequested: false,
    toastVisible: true,
    toastMessage: asciiBytes("Marked as watched"),
  };
}

export function dismissToast(model: Model): Model {
  if (!model.toastVisible) return model;
  return { ...model, toastVisible: false, toastMessage: new Uint8Array(0) };
}

export function playbackElapsedMinutes(model: Model): number {
  return intDiv(model.playbackOffsetMs, 60_000);
}

export function playbackElapsedSeconds(model: Model): number {
  return intDiv(model.playbackOffsetMs, 1_000) - playbackElapsedMinutes(model) * 60;
}

export function playbackRemainingMinutes(model: Model): number {
  return intDiv(Math.max(0, model.selectedDurationMs - model.playbackOffsetMs), 60_000);
}

export function playbackRemainingSeconds(model: Model): number {
  const remainingSeconds = intDiv(
    Math.max(0, model.selectedDurationMs - model.playbackOffsetMs),
    1_000,
  );
  return remainingSeconds - playbackRemainingMinutes(model) * 60;
}

export function playbackRequestedNavigation(model: Model): number {
  return model.screen === "player" ? model.playbackNavigationRequest : 0;
}

export function playbackEpisodeNavigationDisabled(model: Model): boolean {
  return model.detailsHierarchy.length === 0 || model.watchTogetherActive;
}

export function clearPlaybackNavigationRequest(model: Model): Model {
  return model.playbackNavigationRequest === 0
    ? model
    : { ...model, playbackNavigationRequest: 0 };
}

export function visibleItems(model: Model): readonly CatalogItem[] {
  return model.rows[model.rowIndex].items;
}

function catalogItems(model: Model): readonly CatalogItem[] {
  if (model.screen === "browse") return model.browseItems;
  if (model.screen === "search_results") return model.searchItems;
  return visibleItems(model);
}

function catalogPreviewItem(model: Model): CatalogItem {
  const items = catalogItems(model);
  const index = Math.min(Math.max(0, model.selectedIndex), items.length - 1);
  return items[index];
}

export function catalogPreviewTitle(model: Model): Uint8Array {
  return catalogPreviewItem(model).title;
}

export function catalogPreviewSecondary(model: Model): Uint8Array {
  return catalogPreviewItem(model).secondary;
}

export function catalogPreviewHierarchy(model: Model): Uint8Array {
  return catalogPreviewItem(model).hierarchy;
}

export function catalogPreviewHasHierarchy(model: Model): boolean {
  return catalogPreviewItem(model).hasHierarchy;
}

export function previewCatalogItem(model: Model, index: number): Model {
  const items = catalogItems(model);
  if (index < 0 || index >= items.length) return model;
  const item = items[index];
  return {
    ...model,
    selectedIndex: index,
    selectedRatingKey: item.ratingKey,
    selectedImageId: item.imageId,
    selectedTitle: item.title,
    selectedDurationMs: item.durationMs,
    selectedViewOffsetMs: item.viewOffsetMs,
    selectedFromBrowse: model.screen === "browse",
    selectedFromSearch: model.screen === "search_results",
  };
}

export function visibleRowTitle(model: Model): Uint8Array {
  return model.rows[model.rowIndex].title;
}

export function rowCount(model: Model): number {
  return model.rows.length;
}

export function hasMultipleRows(model: Model): boolean {
  return model.rows.length > 1;
}

export function rowPreviousDisabled(model: Model): boolean {
  return model.rowIndex === 0;
}

export function rowNextDisabled(model: Model): boolean {
  return model.rowIndex + 1 >= model.rows.length;
}

export function pairingDemo(model: Model): boolean {
  return !model.pairingEnabled;
}

export function hasResume(model: Model): boolean {
  return model.selectedViewOffsetMs > 0;
}

export function detailsPlayLabel(model: Model): Uint8Array {
  return hasResume(model) ? resumeLabel : playLabel;
}

export function detailsProgressPercent(model: Model): number {
  if (model.selectedDurationMs <= 0 || model.selectedViewOffsetMs <= 0) return 0;
  return Math.min(100, intDiv(model.selectedViewOffsetMs * 100, model.selectedDurationMs));
}

export function detailsHasProgress(model: Model): boolean {
  const progress = detailsProgressPercent(model);
  return progress > 0 && progress < 100;
}

export function pageTitle(model: Model): Uint8Array {
  switch (model.screen) {
    case "home":
      return new Uint8Array(0);
    case "libraries":
      return pageLibraries;
    case "browse":
      return model.selectedLibraryTitle;
    case "search":
      return pageSearch;
    case "search_results":
      return pageSearchResults;
    case "watch_together_invite":
      return pageInvite;
    case "watch_together":
      return pageWatchTogether;
    case "watch_together_room":
      return selectedWatchTogetherRoomTitle(model);
    case "details":
      return new Uint8Array(0);
    default:
      return new Uint8Array(0);
  }
}

export function hasPageTitle(model: Model): boolean {
  return pageTitle(model).length > 0;
}

export function detailsRequestRatingKey(model: Model): number {
  return model.screen === "details" && !model.detailsLoaded ? model.selectedRatingKey : 0;
}

export function detailsLoading(model: Model): boolean {
  return !model.detailsLoaded;
}

export function playbackRequestRatingKey(model: Model): number {
  return model.screen === "player" && !model.playbackLoaded ? model.selectedRatingKey : 0;
}

export function playbackRequestOffsetMs(model: Model): number {
  if (playbackRequestRatingKey(model) === 0 || model.selectedDurationMs <= 1) return 0;
  return Math.min(model.playbackOffsetMs, model.selectedDurationMs - 1);
}

export function playbackLoading(model: Model): boolean {
  return model.screen === "player" && !model.playbackLoaded;
}

export function detailsUnplayable(model: Model): boolean {
  return model.detailsLoaded && !model.detailsPlayable;
}

export function detailsChildrenLoading(model: Model): boolean {
  return model.detailsLoaded && !model.detailsPlayable && !model.detailsChildrenLoaded;
}

export function detailsHasChildren(model: Model): boolean {
  return model.detailsChildrenLoaded && model.detailsChildren.length > 0;
}

export function detailsNoChildren(model: Model): boolean {
  return (
    model.detailsChildrenLoaded && !model.detailsPlayable && model.detailsChildren.length === 0
  );
}

export function detailsChildrenHasPrevious(model: Model): boolean {
  return model.detailsChildrenStart > 0;
}

export function detailsChildrenHasNext(model: Model): boolean {
  return model.detailsChildrenStart + model.detailsChildren.length < model.detailsChildrenTotal;
}

export function detailsChildrenRequestRatingKey(model: Model): number {
  return model.screen === "details" &&
    model.detailsLoaded &&
    !model.detailsPlayable &&
    !model.detailsChildrenLoaded
    ? model.selectedRatingKey
    : 0;
}

export function detailsChildrenRequestStart(model: Model): number {
  return model.detailsChildrenStart;
}

export function detailsHasSecondary(model: Model): boolean {
  return model.detailsSecondary.length > 0;
}

export function detailsHasHierarchy(model: Model): boolean {
  return model.detailsHierarchy.length > 0;
}

export function detailsHasContentRating(model: Model): boolean {
  return model.detailsContentRating.length > 0;
}

export function detailsHasSummary(model: Model): boolean {
  return model.detailsSummary.length > 0;
}

export function detailsHasGenres(model: Model): boolean {
  return model.detailsGenres.length > 0;
}

export function detailsHasDirectors(model: Model): boolean {
  return model.detailsDirectors.length > 0;
}

export function detailsHasFacts(model: Model): boolean {
  return model.detailsFacts.length > 0;
}

export function hasLibraries(model: Model): boolean {
  return model.libraries.length > 0;
}

export function browseHasPrevious(model: Model): boolean {
  return model.browseStart > 0;
}

export function browseHasNext(model: Model): boolean {
  return model.browseStart + model.browseItems.length < model.browseTotal;
}

export function browsePreviousDisabled(model: Model): boolean {
  return !browseHasPrevious(model);
}

export function browseNextDisabled(model: Model): boolean {
  return !browseHasNext(model);
}

export function detailsChildrenPreviousDisabled(model: Model): boolean {
  return !detailsChildrenHasPrevious(model);
}

export function detailsChildrenNextDisabled(model: Model): boolean {
  return !detailsChildrenHasNext(model);
}

export function browseLoading(model: Model): boolean {
  return model.screen === "browse" && !model.browseLoaded && !model.browseFailed;
}

export function browseRequestSection(model: Model): number {
  return model.screen === "browse" && !model.browseLoaded ? model.selectedLibraryId : 0;
}

export function browseRequestStart(model: Model): number {
  return model.browseStart;
}

export function searchPrompt(model: Model): Uint8Array {
  return model.searchQuery.length === 0 ? searchPlaceholder : model.searchQuery;
}

export function searchBeforeCursor(model: Model): Uint8Array {
  return model.searchQuery.slice(0, model.searchCursor);
}

export function searchAfterCursor(model: Model): Uint8Array {
  return model.searchQuery.slice(model.searchCursor);
}

export function keyboardRowOne(_model: Model): readonly KeyboardKey[] {
  return keyboardRowOneKeys;
}

export function keyboardRowTwo(_model: Model): readonly KeyboardKey[] {
  return keyboardRowTwoKeys;
}

export function keyboardRowThree(_model: Model): readonly KeyboardKey[] {
  return keyboardRowThreeKeys;
}

export function searchHasQuery(model: Model): boolean {
  return model.searchQuery.length > 0;
}

export function searchLoading(model: Model): boolean {
  return !model.searchLoaded && !model.searchFailed;
}

export function searchHasResults(model: Model): boolean {
  return model.searchLoaded && model.searchItems.length > 0;
}

export function searchNoResults(model: Model): boolean {
  return model.searchLoaded && model.searchItems.length === 0;
}

export function watchTogetherHasRooms(model: Model): boolean {
  return (
    model.watchTogetherLoaded && model.watchTogetherAvailable && model.watchTogetherRooms.length > 0
  );
}

export function watchTogetherNoRooms(model: Model): boolean {
  return (
    model.watchTogetherLoaded &&
    model.watchTogetherAvailable &&
    !model.watchTogetherCreating &&
    !model.watchTogetherCreateFailed &&
    model.watchTogetherRooms.length === 0
  );
}

export function watchTogetherUnavailable(model: Model): boolean {
  return model.watchTogetherLoaded && !model.watchTogetherAvailable;
}

export function watchTogetherLoading(model: Model): boolean {
  return !model.watchTogetherLoaded || model.watchTogetherCreating;
}

export function watchTogetherHasInvitees(model: Model): boolean {
  return (
    model.watchTogetherInviteesLoaded &&
    model.watchTogetherInviteesAvailable &&
    model.watchTogetherInvitees.length > 0
  );
}

export function watchTogetherNoInvitees(model: Model): boolean {
  return (
    model.watchTogetherInviteesLoaded &&
    model.watchTogetherInviteesAvailable &&
    model.watchTogetherInvitees.length === 0
  );
}

export function watchTogetherInviteesUnavailable(model: Model): boolean {
  return model.watchTogetherInviteesLoaded && !model.watchTogetherInviteesAvailable;
}

export function watchTogetherInviteesLoading(model: Model): boolean {
  return !model.watchTogetherInviteesLoaded;
}

const watchTogetherInviteesPerPage = 4;

export function visibleWatchTogetherInvitees(model: Model): readonly WatchTogetherInvitee[] {
  const start = model.watchTogetherInviteePage * watchTogetherInviteesPerPage;
  return model.watchTogetherInvitees.slice(start, start + watchTogetherInviteesPerPage);
}

export function watchTogetherInviteePageNumber(model: Model): number {
  return model.watchTogetherInviteePage + 1;
}

export function watchTogetherInviteePageCount(model: Model): number {
  return Math.max(1, intDiv(model.watchTogetherInvitees.length + 3, 4));
}

export function watchTogetherInviteesHasPrevious(model: Model): boolean {
  return model.watchTogetherInviteePage > 0;
}

export function watchTogetherInviteesHasNext(model: Model): boolean {
  return model.watchTogetherInviteePage + 1 < watchTogetherInviteePageCount(model);
}

export function watchTogetherCreateRatingKey(model: Model): number {
  return model.screen === "watch_together" && model.watchTogetherCreating
    ? model.selectedRatingKey
    : 0;
}

export function watchTogetherCreateTitle(model: Model): Uint8Array {
  return watchTogetherCreateRatingKey(model) === 0 ? new Uint8Array(0) : model.selectedTitle;
}

export function watchTogetherCreateInviteeId(model: Model): number {
  return watchTogetherCreateRatingKey(model) === 0 ? 0 : model.selectedWatchTogetherInviteeId;
}

export function selectedWatchTogetherRoomTitle(model: Model): Uint8Array {
  if (
    model.selectedWatchTogetherRoomIndex < 0 ||
    model.selectedWatchTogetherRoomIndex >= model.watchTogetherRooms.length
  )
    return new Uint8Array(0);
  return model.watchTogetherRooms[model.selectedWatchTogetherRoomIndex].title;
}

export function selectedWatchTogetherParticipantCount(model: Model): number {
  if (
    model.selectedWatchTogetherRoomIndex < 0 ||
    model.selectedWatchTogetherRoomIndex >= model.watchTogetherRooms.length
  )
    return 0;
  return model.watchTogetherRooms[model.selectedWatchTogetherRoomIndex].participantCount;
}

export function watchTogetherInactive(model: Model): boolean {
  return !model.watchTogetherActive;
}

export function watchTogetherDisconnected(model: Model): boolean {
  return model.watchTogetherActive && !model.watchTogetherConnected;
}

export function watchTogetherJoinRequestIndex(model: Model): number {
  return model.screen === "watch_together_room" && model.watchTogetherJoining
    ? model.selectedWatchTogetherRoomIndex + 1
    : 0;
}

export function searchRequestQuery(model: Model): Uint8Array {
  if (model.screen !== "search_results" || model.searchLoaded) return new Uint8Array(0);
  return model.searchQuery;
}

function insertSearchKey(query: Uint8Array, cursor: number, value: number): Uint8Array {
  if (query.length >= 24) return query;
  const result = new Uint8Array(query.length + 1);
  result.set(query.slice(0, cursor), 0);
  result[cursor] = value;
  result.set(query.slice(cursor), cursor + 1);
  return result;
}

function deleteSearchKey(query: Uint8Array, cursor: number): Uint8Array {
  if (cursor <= 0 || query.length === 0) return query;
  const result = new Uint8Array(query.length - 1);
  result.set(query.slice(0, cursor - 1), 0);
  result.set(query.slice(cursor), cursor - 1);
  return result;
}

// Native SDK v1 gives a number slot one machine type, so `/` would push the
// millisecond fields into its fractional tier. Binary long division keeps the
// playback model and its derived percentage entirely integer-valued.
function intDiv(numerator: number, denominator: number): number {
  let quotient = 0;
  let remainder = numerator;
  while (remainder >= denominator) {
    let step = denominator;
    let count = 1;
    while (step + step <= remainder) {
      step += step;
      count += count;
    }
    remainder -= step;
    quotient += count;
  }
  return quotient;
}

function updateItemProgress(item: CatalogItem, positionMs: number): CatalogItem {
  const viewOffsetMs = Math.min(Math.max(0, positionMs), Math.max(0, item.durationMs - 1));
  const progressPercent =
    item.durationMs === 0 ? 0 : Math.min(100, intDiv(viewOffsetMs * 100, item.durationMs));
  return { ...item, viewOffsetMs: viewOffsetMs, progressPercent: progressPercent };
}

function commitSelectedProgressAt(model: Model, positionMs: number): Model {
  const selectedViewOffsetMs = Math.min(
    Math.max(0, positionMs),
    Math.max(0, model.selectedDurationMs - 1),
  );
  if (model.detailsHistory.length > 0) {
    return { ...model, selectedViewOffsetMs: selectedViewOffsetMs };
  }
  if (model.selectedFromBrowse) {
    const browseItems = model.browseItems.slice();
    browseItems[model.selectedIndex] = updateItemProgress(
      browseItems[model.selectedIndex],
      selectedViewOffsetMs,
    );
    return { ...model, selectedViewOffsetMs: selectedViewOffsetMs, browseItems: browseItems };
  }
  if (model.selectedFromSearch) {
    const searchItems = model.searchItems.slice();
    searchItems[model.selectedIndex] = updateItemProgress(
      searchItems[model.selectedIndex],
      selectedViewOffsetMs,
    );
    return { ...model, selectedViewOffsetMs: selectedViewOffsetMs, searchItems: searchItems };
  }
  const rows = model.rows.slice();
  const row = rows[model.rowIndex];
  const items = row.items.slice();
  items[model.selectedIndex] = updateItemProgress(items[model.selectedIndex], selectedViewOffsetMs);
  rows[model.rowIndex] = { ...row, items: items };
  return { ...model, selectedViewOffsetMs: selectedViewOffsetMs, rows: rows };
}

function commitSelectedProgress(model: Model): Model {
  return commitSelectedProgressAt(model, model.playbackOffsetMs);
}

export function update(model: Model, msg: Msg): Model {
  switch (msg.kind) {
    case "connect_demo":
      return model.pairingEnabled ? model : { ...model, screen: "home" };
    case "previous_row": {
      if (model.rowIndex === 0) return model;
      const rowIndex = model.rowIndex - 1;
      return previewCatalogItem({ ...model, rowIndex: rowIndex, rowNumber: rowIndex + 1 }, 0);
    }
    case "next_row": {
      if (model.rowIndex + 1 >= model.rows.length) return model;
      const rowIndex = model.rowIndex + 1;
      return previewCatalogItem({ ...model, rowIndex: rowIndex, rowNumber: rowIndex + 1 }, 0);
    }
    case "open_libraries":
      return { ...model, screen: "libraries" };
    case "open_library": {
      if (msg.index < 0 || msg.index >= model.libraries.length) return model;
      const library = model.libraries[msg.index];
      return {
        ...model,
        screen: "browse",
        selectedLibraryId: library.sectionId,
        selectedLibraryTitle: library.title,
        browseItems: [],
        browseStart: 0,
        browsePageNumber: 1,
        browsePageCount: 1,
        browseTotal: 0,
        browseLoaded: false,
        browseFailed: false,
      };
    }
    case "browse_previous": {
      if (model.screen !== "browse" || model.browseStart === 0) return model;
      const start = model.browseStart < 4 ? 0 : model.browseStart - 4;
      return { ...model, browseStart: start, browseLoaded: false, browseFailed: false };
    }
    case "browse_next": {
      if (model.screen !== "browse" || !browseHasNext(model)) return model;
      return {
        ...model,
        browseStart: model.browseStart + 4,
        browseLoaded: false,
        browseFailed: false,
      };
    }
    case "open_search":
      return {
        ...model,
        screen: "search",
        searchQuery: new Uint8Array(0),
        searchCursor: 0,
        searchItems: [],
        searchLoaded: true,
        searchFailed: false,
      };
    case "search_key": {
      if (model.screen !== "search" || msg.index < 0 || msg.index >= keyboardKeys.length) {
        return model;
      }
      return {
        ...model,
        searchQuery: insertSearchKey(
          model.searchQuery,
          model.searchCursor,
          keyboardKeys[msg.index].value,
        ),
        searchCursor: Math.min(model.searchCursor + 1, 24),
      };
    }
    case "search_delete":
      if (model.screen !== "search" || model.searchCursor <= 0) return model;
      return {
        ...model,
        searchQuery: deleteSearchKey(model.searchQuery, model.searchCursor),
        searchCursor: model.searchCursor - 1,
      };
    case "search_cursor_left":
      if (model.screen !== "search" || model.searchCursor <= 0) return model;
      return { ...model, searchCursor: model.searchCursor - 1 };
    case "search_cursor_right":
      if (model.screen !== "search" || model.searchCursor >= model.searchQuery.length) return model;
      return { ...model, searchCursor: model.searchCursor + 1 };
    case "search_submit":
      if (model.screen !== "search" || model.searchQuery.length === 0) return model;
      return {
        ...model,
        screen: "search_results",
        searchItems: [],
        searchLoaded: false,
        searchFailed: false,
      };
    case "open_watch_together":
      if (!model.pairingLinked || model.screen === "player") return model;
      return { ...model, screen: "watch_together", startMenuOpen: false };
    case "open_start_menu":
      if (!model.pairingLinked || model.screen === "player") return model;
      return { ...model, startMenuOpen: true };
    case "close_start_menu":
      return model.startMenuOpen ? { ...model, startMenuOpen: false } : model;
    case "start_menu_play":
      return model.startMenuOpen
        ? update({ ...model, startMenuOpen: false }, { kind: "play" })
        : model;
    case "start_menu_mark_watched":
      return model.startMenuOpen
        ? update({ ...model, startMenuOpen: false }, { kind: "mark_watched" })
        : model;
    case "start_menu_create_watch_together":
      return model.startMenuOpen
        ? update({ ...model, startMenuOpen: false }, { kind: "create_watch_together" })
        : model;
    case "start_menu_watch_together":
      return model.startMenuOpen
        ? update({ ...model, startMenuOpen: false }, { kind: "open_watch_together" })
        : model;
    case "start_menu_libraries":
      return model.startMenuOpen
        ? update({ ...model, startMenuOpen: false }, { kind: "open_libraries" })
        : model;
    case "start_menu_search":
      return model.startMenuOpen
        ? update({ ...model, startMenuOpen: false }, { kind: "open_search" })
        : model;
    case "create_watch_together":
      if (
        !model.pairingLinked ||
        model.screen !== "details" ||
        !model.detailsLoaded ||
        !model.detailsPlayable
      )
        return model;
      return {
        ...model,
        screen: "watch_together_invite",
        startMenuOpen: false,
        watchTogetherInviteePage: 0,
        watchTogetherCreateFailed: false,
      };
    case "watch_together_invitees_previous":
      if (model.screen !== "watch_together_invite" || model.watchTogetherInviteePage <= 0)
        return model;
      return { ...model, watchTogetherInviteePage: model.watchTogetherInviteePage - 1 };
    case "watch_together_invitees_next":
      if (
        model.screen !== "watch_together_invite" ||
        model.watchTogetherInviteePage + 1 >= watchTogetherInviteePageCount(model)
      )
        return model;
      return { ...model, watchTogetherInviteePage: model.watchTogetherInviteePage + 1 };
    case "invite_watch_together":
      if (
        model.screen !== "watch_together_invite" ||
        msg.index < 0 ||
        msg.index >= model.watchTogetherInvitees.length
      )
        return model;
      return {
        ...model,
        screen: "watch_together",
        selectedWatchTogetherInviteeId: model.watchTogetherInvitees[msg.index].userId,
        watchTogetherCreating: true,
        watchTogetherCreateFailed: false,
      };
    case "join_watch_together":
      if (
        model.screen !== "watch_together" ||
        msg.index < 0 ||
        msg.index >= model.watchTogetherRooms.length
      )
        return model;
      return {
        ...model,
        screen: "watch_together_room",
        selectedWatchTogetherRoomIndex: msg.index,
        watchTogetherJoining: true,
        watchTogetherConnected: false,
        watchTogetherJoinFailed: false,
        watchTogetherActive: false,
        watchTogetherPresentCount: 0,
        watchTogetherHost: false,
        watchTogetherLeaveRequested: false,
        watchTogetherReconnectRequested: false,
        watchTogetherDisbandRequested: false,
        watchTogetherDisbandFailed: false,
      };
    case "leave_watch_together":
      return model.screen === "player" ? leaveWatchTogether(model) : model;
    case "reconnect_watch_together":
      if (model.screen !== "player" || !model.watchTogetherActive) return model;
      return { ...model, watchTogetherReconnectRequested: true };
    case "disband_watch_together":
      return model.screen === "player" ? disbandWatchTogether(model) : model;
    case "open_item": {
      const items =
        model.screen === "browse"
          ? model.browseItems
          : model.screen === "search_results"
            ? model.searchItems
            : model.rows[model.rowIndex].items;
      if (msg.index < 0 || msg.index >= items.length) return model;
      const item = items[msg.index];
      return {
        ...model,
        screen: "details",
        selectedIndex: msg.index,
        selectedRatingKey: item.ratingKey,
        selectedImageId: item.imageId,
        selectedTitle: item.title,
        selectedDurationMs: item.durationMs,
        selectedViewOffsetMs: item.viewOffsetMs,
        selectedFromBrowse: model.screen === "browse",
        selectedFromSearch: model.screen === "search_results",
        detailsLoaded: !model.gatewayConnected,
        detailsHierarchy: new Uint8Array(0),
        detailsChildren: [],
        detailsChildrenStart: 0,
        detailsChildrenPageNumber: 1,
        detailsChildrenPageCount: 1,
        detailsChildrenTotal: 0,
        detailsChildrenLoaded: !model.gatewayConnected,
        detailsHistory: [],
      };
    }
    case "open_details_child": {
      if (
        model.screen !== "details" ||
        !model.detailsChildrenLoaded ||
        msg.index < 0 ||
        msg.index >= model.detailsChildren.length
      )
        return model;
      const child = model.detailsChildren[msg.index];
      const parent: CatalogItem = {
        id: model.detailsHistory.length,
        ratingKey: model.selectedRatingKey,
        title: model.selectedTitle,
        subtitle: model.detailsType,
        secondary: model.detailsType,
        hierarchy: new Uint8Array(0),
        hasHierarchy: false,
        imageId: model.selectedImageId,
        durationMs: model.selectedDurationMs,
        viewOffsetMs: model.selectedViewOffsetMs,
        progressPercent: 0,
      };
      return {
        ...model,
        selectedRatingKey: child.ratingKey,
        selectedTitle: child.title,
        selectedDurationMs: child.durationMs,
        selectedViewOffsetMs: child.viewOffsetMs,
        detailsLoaded: false,
        detailsHierarchy: new Uint8Array(0),
        detailsChildren: [],
        detailsChildrenStart: 0,
        detailsChildrenPageNumber: 1,
        detailsChildrenPageCount: 1,
        detailsChildrenTotal: 0,
        detailsChildrenLoaded: false,
        detailsHistory: [...model.detailsHistory, parent],
      };
    }
    case "details_children_previous": {
      if (model.screen !== "details" || model.detailsChildrenStart === 0) return model;
      const start = model.detailsChildrenStart < 4 ? 0 : model.detailsChildrenStart - 4;
      return { ...model, detailsChildrenStart: start, detailsChildrenLoaded: false };
    }
    case "details_children_next":
      if (model.screen !== "details" || !detailsChildrenHasNext(model)) return model;
      return {
        ...model,
        detailsChildrenStart: model.detailsChildrenStart + 4,
        detailsChildrenLoaded: false,
      };
    case "play":
      if (model.screen !== "details" || !model.detailsLoaded || !model.detailsPlayable)
        return model;
      return {
        ...model,
        screen: "player",
        playbackOffsetMs: Math.min(
          model.selectedViewOffsetMs,
          Math.max(0, model.selectedDurationMs - 1),
        ),
        playbackLoaded: !model.gatewayConnected,
        playing: !model.gatewayConnected,
        playbackNavigationRequest: 0,
      };
    case "mark_watched":
      if (model.screen !== "details" || !model.detailsLoaded || !model.detailsPlayable)
        return model;
      return { ...model, markWatchedRequested: true };
    case "seek_backward": {
      if (model.screen !== "player" || !model.playbackLoaded) return model;
      const playbackOffsetMs = Math.max(0, model.playbackOffsetMs - 10_000);
      if (playbackOffsetMs === model.playbackOffsetMs) return model;
      return {
        ...model,
        playbackOffsetMs: playbackOffsetMs,
        playbackLoaded: false,
        playing: false,
      };
    }
    case "seek_forward": {
      if (model.screen !== "player" || !model.playbackLoaded) return model;
      const playbackOffsetMs = Math.min(
        Math.max(0, model.selectedDurationMs - 1),
        model.playbackOffsetMs + 30_000,
      );
      if (playbackOffsetMs === model.playbackOffsetMs) return model;
      return {
        ...model,
        playbackOffsetMs: playbackOffsetMs,
        playbackLoaded: false,
        playing: false,
      };
    }
    case "open_player_settings":
      if (model.screen !== "player" || !model.playbackLoaded) return model;
      return { ...model, playerSettingsOpen: true };
    case "close_player_settings":
      return model.playerSettingsOpen ? { ...model, playerSettingsOpen: false } : model;
    case "stop_playback":
      return model.screen === "player" ? update(model, { kind: "back" }) : model;
    case "play_previous":
      if (model.screen !== "player" || !model.playbackLoaded) return model;
      return { ...model, playbackNavigationRequest: -1 };
    case "play_next":
      if (model.screen !== "player" || !model.playbackLoaded) return model;
      return { ...model, playbackNavigationRequest: 1 };
    case "sync_playback": {
      if (model.screen !== "player" || !model.playbackLoaded || model.selectedDurationMs <= 1) {
        return model;
      }
      const playbackOffsetMs = Math.min(Math.max(0, msg.positionMs), model.selectedDurationMs - 1);
      return { ...model, playbackOffsetMs: playbackOffsetMs };
    }
    case "continue_playback": {
      if (model.screen !== "player" || !model.playbackLoaded || model.selectedDurationMs <= 1) {
        return model;
      }
      const playbackOffsetMs = Math.min(Math.max(0, msg.positionMs), model.selectedDurationMs - 1);
      if (playbackOffsetMs <= model.playbackOffsetMs) return model;
      return {
        ...model,
        playbackOffsetMs: playbackOffsetMs,
        playbackLoaded: false,
        playing: false,
      };
    }
    case "complete_playback":
      if (model.screen !== "player" || !model.playbackLoaded) return model;
      return {
        ...model,
        playbackOffsetMs: Math.max(0, model.selectedDurationMs - 1),
        playing: false,
      };
    case "toggle_playback":
      if (model.screen !== "player" || !model.playbackLoaded) return model;
      return { ...model, playing: !model.playing };
    case "cycle_subtitles":
      if (model.screen !== "player" || !model.playbackLoaded || model.subtitleStreamCount === 0)
        return model;
      return {
        ...model,
        selectedSubtitleStream:
          model.selectedSubtitleStream >= model.subtitleStreamCount
            ? 0
            : model.selectedSubtitleStream + 1,
        playbackLoaded: false,
        playing: false,
      };
    case "back":
      if (model.playerSettingsOpen) return { ...model, playerSettingsOpen: false };
      if (model.startMenuOpen) return { ...model, startMenuOpen: false };
      if (model.screen === "player") {
        if (model.watchTogetherActive) return leaveWatchTogether(model);
        const progressed = commitSelectedProgress(model);
        return {
          ...progressed,
          screen: "details",
          playing: false,
        };
      }
      if (model.screen === "details") {
        if (model.detailsHistory.length > 0) {
          const historyIndex = model.detailsHistory.length - 1;
          const parent = model.detailsHistory[historyIndex];
          return {
            ...model,
            selectedRatingKey: parent.ratingKey,
            selectedImageId: parent.imageId,
            selectedTitle: parent.title,
            selectedDurationMs: parent.durationMs,
            selectedViewOffsetMs: parent.viewOffsetMs,
            detailsLoaded: false,
            detailsChildren: [],
            detailsChildrenStart: 0,
            detailsChildrenPageNumber: 1,
            detailsChildrenPageCount: 1,
            detailsChildrenTotal: 0,
            detailsChildrenLoaded: false,
            detailsHistory: model.detailsHistory.slice(0, historyIndex),
          };
        }
        return {
          ...model,
          screen: model.selectedFromBrowse
            ? "browse"
            : model.selectedFromSearch
              ? "search_results"
              : "home",
          playing: false,
        };
      }
      if (model.screen === "search_results") {
        return { ...model, screen: "search", playing: false };
      }
      if (model.screen === "search") {
        return { ...model, screen: "home", playing: false };
      }
      if (model.screen === "watch_together") {
        return { ...model, screen: "home", playing: false };
      }
      if (model.screen === "watch_together_invite") {
        return { ...model, screen: "details", playing: false };
      }
      if (model.screen === "watch_together_room") {
        return {
          ...model,
          screen: "watch_together",
          watchTogetherJoining: false,
          watchTogetherConnected: false,
          watchTogetherJoinFailed: false,
        };
      }
      if (model.screen === "browse") {
        return { ...model, screen: "libraries", playing: false };
      }
      if (model.screen === "libraries") {
        return { ...model, screen: "home", playing: false };
      }
      return model;
  }
}
