import { asciiBytes } from "@native-sdk/core";

export type Screen =
  | "pairing"
  | "home"
  | "libraries"
  | "browse"
  | "search"
  | "search_results"
  | "details"
  | "player";

export interface CatalogItem {
  readonly id: number;
  readonly ratingKey: number;
  readonly title: Uint8Array;
  readonly subtitle: Uint8Array;
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

export interface Model {
  readonly screen: Screen;
  readonly gatewayConnected: boolean;
  readonly gatewayName: Uint8Array;
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
  readonly searchQuery: Uint8Array;
  readonly searchItems: readonly CatalogItem[];
  readonly searchLoaded: boolean;
  readonly selectedFromSearch: boolean;
  readonly detailsLoaded: boolean;
  readonly detailsPlayable: boolean;
  readonly detailsSecondary: Uint8Array;
  readonly detailsType: Uint8Array;
  readonly detailsLibrary: Uint8Array;
  readonly detailsContentRating: Uint8Array;
  readonly detailsFacts: Uint8Array;
  readonly detailsSummary: Uint8Array;
  readonly detailsGenres: Uint8Array;
  readonly detailsDirectors: Uint8Array;
  readonly playbackLoaded: boolean;
  readonly playing: boolean;
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
  | { readonly kind: "search_submit" }
  | { readonly kind: "open_item"; readonly index: number }
  | { readonly kind: "play" }
  | { readonly kind: "toggle_playback" }
  | { readonly kind: "back" };

const demoItems: readonly CatalogItem[] = [
  {
    id: 0,
    ratingKey: 1,
    title: asciiBytes("The Fifth Element"),
    subtitle: asciiBytes("Movie"),
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
  { id: 0, label: asciiBytes("A"), value: 65 },
  { id: 1, label: asciiBytes("B"), value: 66 },
  { id: 2, label: asciiBytes("C"), value: 67 },
  { id: 3, label: asciiBytes("D"), value: 68 },
  { id: 4, label: asciiBytes("E"), value: 69 },
  { id: 5, label: asciiBytes("F"), value: 70 },
  { id: 6, label: asciiBytes("G"), value: 71 },
  { id: 7, label: asciiBytes("H"), value: 72 },
  { id: 8, label: asciiBytes("I"), value: 73 },
  { id: 9, label: asciiBytes("J"), value: 74 },
  { id: 10, label: asciiBytes("K"), value: 75 },
  { id: 11, label: asciiBytes("L"), value: 76 },
  { id: 12, label: asciiBytes("M"), value: 77 },
  { id: 13, label: asciiBytes("N"), value: 78 },
  { id: 14, label: asciiBytes("O"), value: 79 },
  { id: 15, label: asciiBytes("P"), value: 80 },
  { id: 16, label: asciiBytes("Q"), value: 81 },
  { id: 17, label: asciiBytes("R"), value: 82 },
  { id: 18, label: asciiBytes("S"), value: 83 },
  { id: 19, label: asciiBytes("T"), value: 84 },
  { id: 20, label: asciiBytes("U"), value: 85 },
  { id: 21, label: asciiBytes("V"), value: 86 },
  { id: 22, label: asciiBytes("W"), value: 87 },
  { id: 23, label: asciiBytes("X"), value: 88 },
  { id: 24, label: asciiBytes("Y"), value: 89 },
  { id: 25, label: asciiBytes("Z"), value: 90 },
];

const keyboardRowOneKeys: readonly KeyboardKey[] = [
  { id: 0, label: asciiBytes("A"), value: 65 },
  { id: 1, label: asciiBytes("B"), value: 66 },
  { id: 2, label: asciiBytes("C"), value: 67 },
  { id: 3, label: asciiBytes("D"), value: 68 },
  { id: 4, label: asciiBytes("E"), value: 69 },
  { id: 5, label: asciiBytes("F"), value: 70 },
  { id: 6, label: asciiBytes("G"), value: 71 },
  { id: 7, label: asciiBytes("H"), value: 72 },
  { id: 8, label: asciiBytes("I"), value: 73 },
];

const keyboardRowTwoKeys: readonly KeyboardKey[] = [
  { id: 9, label: asciiBytes("J"), value: 74 },
  { id: 10, label: asciiBytes("K"), value: 75 },
  { id: 11, label: asciiBytes("L"), value: 76 },
  { id: 12, label: asciiBytes("M"), value: 77 },
  { id: 13, label: asciiBytes("N"), value: 78 },
  { id: 14, label: asciiBytes("O"), value: 79 },
  { id: 15, label: asciiBytes("P"), value: 80 },
  { id: 16, label: asciiBytes("Q"), value: 81 },
  { id: 17, label: asciiBytes("R"), value: 82 },
];

const keyboardRowThreeKeys: readonly KeyboardKey[] = [
  { id: 18, label: asciiBytes("S"), value: 83 },
  { id: 19, label: asciiBytes("T"), value: 84 },
  { id: 20, label: asciiBytes("U"), value: 85 },
  { id: 21, label: asciiBytes("V"), value: 86 },
  { id: 22, label: asciiBytes("W"), value: 87 },
  { id: 23, label: asciiBytes("X"), value: 88 },
  { id: 24, label: asciiBytes("Y"), value: 89 },
  { id: 25, label: asciiBytes("Z"), value: 90 },
];

const emptySearchPrompt = asciiBytes("Choose letters with A");
const unavailableDetailsType = asciiBytes("Plex result");
const unavailableDetailsSummary = asciiBytes(
  "Full metadata is not available for this result yet. Return and choose a playable library item.",
);

export function initialModel(): Model {
  return {
    screen: "pairing",
    gatewayConnected: false,
    gatewayName: asciiBytes("Demo library"),
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
    searchQuery: new Uint8Array(0),
    searchItems: [],
    searchLoaded: true,
    selectedFromSearch: false,
    detailsLoaded: true,
    detailsPlayable: true,
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
    playbackLoaded: true,
    playing: false,
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
    gatewayConnected: true,
    gatewayName: gatewayName,
    rows: rows,
    libraries: libraries.length === 0 ? model.libraries : libraries,
    rowIndex: 0,
    rowNumber: 1,
    selectedIndex: 0,
    selectedTitle: rows[0].items[0].title,
    selectedDurationMs: rows[0].items[0].durationMs,
    selectedViewOffsetMs: rows[0].items[0].viewOffsetMs,
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
  return {
    ...model,
    selectedLibraryTitle: title,
    browseItems: items,
    browseStart: start,
    browsePageNumber: pageNumber,
    browsePageCount: pageCount,
    browseTotal: total,
    browseLoaded: true,
  };
}

export function loadSearch(model: Model, query: Uint8Array, items: readonly CatalogItem[]): Model {
  if (model.screen !== "search_results" || query.length === 0) return model;
  return { ...model, searchQuery: query, searchItems: items, searchLoaded: true };
}

export function loadDetails(
  model: Model,
  title: Uint8Array,
  secondary: Uint8Array,
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
  return { ...model, screen: "details", playbackLoaded: false, playing: false };
}

export function visibleItems(model: Model): readonly CatalogItem[] {
  return model.rows[model.rowIndex].items;
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

export function hasResume(model: Model): boolean {
  return model.selectedViewOffsetMs > 0;
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
  return Math.min(model.selectedViewOffsetMs, model.selectedDurationMs - 1);
}

export function playbackLoading(model: Model): boolean {
  return model.screen === "player" && !model.playbackLoaded;
}

export function detailsUnplayable(model: Model): boolean {
  return model.detailsLoaded && !model.detailsPlayable;
}

export function detailsHasSecondary(model: Model): boolean {
  return model.detailsSecondary.length > 0;
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

export function browseLoading(model: Model): boolean {
  return !model.browseLoaded;
}

export function browseRequestSection(model: Model): number {
  return model.screen === "browse" && !model.browseLoaded ? model.selectedLibraryId : 0;
}

export function browseRequestStart(model: Model): number {
  return model.browseStart;
}

export function searchPrompt(model: Model): Uint8Array {
  return model.searchQuery.length === 0 ? emptySearchPrompt : model.searchQuery;
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
  return !model.searchLoaded;
}

export function searchHasResults(model: Model): boolean {
  return model.searchLoaded && model.searchItems.length > 0;
}

export function searchNoResults(model: Model): boolean {
  return model.searchLoaded && model.searchItems.length === 0;
}

export function searchRequestQuery(model: Model): Uint8Array {
  if (model.screen !== "search_results" || model.searchLoaded) return new Uint8Array(0);
  return model.searchQuery;
}

function appendSearchKey(query: Uint8Array, value: number): Uint8Array {
  if (query.length >= 24) return query;
  const result = new Uint8Array(query.length + 1);
  result.set(query, 0);
  result[query.length] = value;
  return result;
}

export function update(model: Model, msg: Msg): Model {
  switch (msg.kind) {
    case "connect_demo":
      return { ...model, screen: "home" };
    case "previous_row": {
      const rowIndex = model.rowIndex === 0 ? model.rows.length - 1 : model.rowIndex - 1;
      return { ...model, rowIndex: rowIndex, rowNumber: rowIndex + 1 };
    }
    case "next_row": {
      const rowIndex = model.rowIndex === model.rows.length - 1 ? 0 : model.rowIndex + 1;
      return { ...model, rowIndex: rowIndex, rowNumber: rowIndex + 1 };
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
      };
    }
    case "browse_previous": {
      if (model.screen !== "browse" || model.browseStart === 0) return model;
      const start = model.browseStart < 4 ? 0 : model.browseStart - 4;
      return { ...model, browseStart: start, browseLoaded: false };
    }
    case "browse_next": {
      if (model.screen !== "browse" || !browseHasNext(model)) return model;
      return { ...model, browseStart: model.browseStart + 4, browseLoaded: false };
    }
    case "open_search":
      return {
        ...model,
        screen: "search",
        searchQuery: new Uint8Array(0),
        searchItems: [],
        searchLoaded: true,
      };
    case "search_key": {
      if (model.screen !== "search" || msg.index < 0 || msg.index >= keyboardKeys.length) {
        return model;
      }
      return {
        ...model,
        searchQuery: appendSearchKey(model.searchQuery, keyboardKeys[msg.index].value),
      };
    }
    case "search_delete":
      if (model.screen !== "search" || model.searchQuery.length === 0) return model;
      return { ...model, searchQuery: model.searchQuery.slice(0, model.searchQuery.length - 1) };
    case "search_submit":
      if (model.screen !== "search" || model.searchQuery.length === 0) return model;
      return { ...model, screen: "search_results", searchItems: [], searchLoaded: false };
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
      };
    }
    case "play":
      if (model.screen !== "details" || !model.detailsLoaded || !model.detailsPlayable)
        return model;
      return {
        ...model,
        screen: "player",
        playbackLoaded: !model.gatewayConnected,
        playing: !model.gatewayConnected,
      };
    case "toggle_playback":
      if (model.screen !== "player" || !model.playbackLoaded) return model;
      return { ...model, playing: !model.playing };
    case "back":
      if (model.screen === "player") {
        return { ...model, screen: "details", playing: false };
      }
      if (model.screen === "details") {
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
      if (model.screen === "browse") {
        return { ...model, screen: "libraries", playing: false };
      }
      if (model.screen === "libraries") {
        return { ...model, screen: "home", playing: false };
      }
      return model;
  }
}
