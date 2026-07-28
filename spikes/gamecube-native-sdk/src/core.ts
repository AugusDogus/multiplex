import { asciiBytes } from "@native-sdk/core";

export type Screen = "pairing" | "home" | "details" | "player";

export interface Model {
  readonly screen: Screen;
  readonly gatewayConnected: boolean;
  readonly gatewayName: Uint8Array;
  readonly itemCount: number;
  readonly title0: Uint8Array;
  readonly title1: Uint8Array;
  readonly title2: Uint8Array;
  readonly title3: Uint8Array;
  readonly selectedIndex: number;
  readonly selectionNumber: number;
  readonly selectedTitle: Uint8Array;
  readonly playing: boolean;
}

export type Msg =
  | { readonly kind: "connect_demo" }
  | { readonly kind: "gateway_ready"; readonly itemCount: number; readonly serverName: Uint8Array }
  | { readonly kind: "catalog_item"; readonly index: number; readonly title: Uint8Array }
  | { readonly kind: "previous" }
  | { readonly kind: "next" }
  | { readonly kind: "open" }
  | { readonly kind: "play" }
  | { readonly kind: "toggle_playback" }
  | { readonly kind: "back" };

export function initialModel(): Model {
  return {
    screen: "pairing",
    gatewayConnected: false,
    gatewayName: asciiBytes("Demo library"),
    itemCount: 4,
    title0: asciiBytes("The Fifth Element"),
    title1: asciiBytes("Alien"),
    title2: asciiBytes("Spirited Away"),
    title3: asciiBytes("Twin Peaks"),
    selectedIndex: 0,
    selectionNumber: 1,
    selectedTitle: asciiBytes("The Fifth Element"),
    playing: false,
  };
}

function titleFor(model: Model, index: number): Uint8Array {
  switch (index) {
    case 0:
      return model.title0;
    case 1:
      return model.title1;
    case 2:
      return model.title2;
    case 3:
      return model.title3;
  }
  return model.title0;
}

export function update(model: Model, msg: Msg): Model {
  switch (msg.kind) {
    case "connect_demo":
      return { ...model, screen: "home", gatewayConnected: true };
    case "gateway_ready": {
      const itemCount = msg.itemCount < 1 ? 1 : msg.itemCount > 4 ? 4 : msg.itemCount;
      return {
        ...model,
        gatewayConnected: true,
        gatewayName: msg.serverName,
        itemCount: itemCount,
        selectedIndex: 0,
        selectionNumber: 1,
      };
    }
    case "catalog_item":
      if (msg.index === 0) {
        return { ...model, title0: msg.title, selectedTitle: msg.title };
      }
      if (msg.index === 1) return { ...model, title1: msg.title };
      if (msg.index === 2) return { ...model, title2: msg.title };
      if (msg.index === 3) return { ...model, title3: msg.title };
      return model;
    case "previous": {
      const selectedIndex =
        model.selectedIndex === 0 ? model.itemCount - 1 : model.selectedIndex - 1;
      return {
        ...model,
        selectedIndex: selectedIndex,
        selectionNumber: selectedIndex + 1,
        selectedTitle: titleFor(model, selectedIndex),
      };
    }
    case "next": {
      const selectedIndex =
        model.selectedIndex === model.itemCount - 1 ? 0 : model.selectedIndex + 1;
      return {
        ...model,
        selectedIndex: selectedIndex,
        selectionNumber: selectedIndex + 1,
        selectedTitle: titleFor(model, selectedIndex),
      };
    }
    case "open":
      if (!model.gatewayConnected) return model;
      return { ...model, screen: "details" };
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
