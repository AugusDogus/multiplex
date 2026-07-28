import { asciiBytes } from "@native-sdk/core";

export type Screen = "pairing" | "home" | "libraries" | "browse" | "details" | "player";

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

export interface Model {
  readonly screen: Screen;
  readonly gatewayConnected: boolean;
  readonly gatewayName: Uint8Array;
  readonly rows: readonly CatalogRow[];
  readonly libraries: readonly LibrarySection[];
  readonly rowIndex: number;
  readonly rowNumber: number;
  readonly selectedIndex: number;
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

export function update(model: Model, msg: Msg): Model {
  switch (msg.kind) {
    case "connect_demo":
      return { ...model, screen: "home", gatewayConnected: true };
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
    case "open_item": {
      const items =
        model.screen === "browse" ? model.browseItems : model.rows[model.rowIndex].items;
      if (msg.index < 0 || msg.index >= items.length) return model;
      const item = items[msg.index];
      return {
        ...model,
        screen: "details",
        selectedIndex: msg.index,
        selectedTitle: item.title,
        selectedDurationMs: item.durationMs,
        selectedViewOffsetMs: item.viewOffsetMs,
        selectedFromBrowse: model.screen === "browse",
      };
    }
    case "play":
      if (model.screen !== "details") return model;
      return { ...model, screen: "player", playing: true };
    case "toggle_playback":
      if (model.screen !== "player") return model;
      return { ...model, playing: !model.playing };
    case "back":
      if (model.screen === "player") {
        return { ...model, screen: "details", playing: false };
      }
      if (model.screen === "details") {
        return {
          ...model,
          screen: model.selectedFromBrowse ? "browse" : "home",
          playing: false,
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
