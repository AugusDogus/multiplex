import { asciiBytes } from "@native-sdk/core";

export type Screen = "pairing" | "home" | "details" | "player";

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

export interface Model {
  readonly screen: Screen;
  readonly gatewayConnected: boolean;
  readonly gatewayName: Uint8Array;
  readonly rows: readonly CatalogRow[];
  readonly rowIndex: number;
  readonly rowNumber: number;
  readonly selectedIndex: number;
  readonly selectedTitle: Uint8Array;
  readonly selectedDurationMs: number;
  readonly selectedViewOffsetMs: number;
  readonly playing: boolean;
}

export type Msg =
  | { readonly kind: "connect_demo" }
  | { readonly kind: "previous_row" }
  | { readonly kind: "next_row" }
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

export function initialModel(): Model {
  return {
    screen: "pairing",
    gatewayConnected: false,
    gatewayName: asciiBytes("Demo library"),
    rows: demoRows,
    rowIndex: 0,
    rowNumber: 1,
    selectedIndex: 0,
    selectedTitle: demoItems[0].title,
    selectedDurationMs: 0,
    selectedViewOffsetMs: 0,
    playing: false,
  };
}

export function loadCatalog(
  model: Model,
  gatewayName: Uint8Array,
  rows: readonly CatalogRow[],
): Model {
  if (rows.length === 0 || rows[0].items.length === 0) return model;
  return {
    ...model,
    gatewayConnected: true,
    gatewayName: gatewayName,
    rows: rows,
    rowIndex: 0,
    rowNumber: 1,
    selectedIndex: 0,
    selectedTitle: rows[0].items[0].title,
    selectedDurationMs: rows[0].items[0].durationMs,
    selectedViewOffsetMs: rows[0].items[0].viewOffsetMs,
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
    case "open_item": {
      const items = model.rows[model.rowIndex].items;
      if (msg.index < 0 || msg.index >= items.length) return model;
      const item = items[msg.index];
      return {
        ...model,
        screen: "details",
        selectedIndex: msg.index,
        selectedTitle: item.title,
        selectedDurationMs: item.durationMs,
        selectedViewOffsetMs: item.viewOffsetMs,
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
        return { ...model, screen: "home", playing: false };
      }
      return model;
  }
}
