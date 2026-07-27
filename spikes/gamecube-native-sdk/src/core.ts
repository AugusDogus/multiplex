import { asciiBytes } from "@native-sdk/core";

export type Screen = "pairing" | "home" | "details";

export interface Model {
  readonly screen: Screen;
  readonly gatewayConnected: boolean;
  readonly selectedIndex: number;
  readonly selectionNumber: number;
  readonly selectedTitle: Uint8Array;
}

export type Msg =
  | { readonly kind: "connect_demo" }
  | { readonly kind: "previous" }
  | { readonly kind: "next" }
  | { readonly kind: "open" }
  | { readonly kind: "back" };

export function initialModel(): Model {
  return {
    screen: "pairing",
    gatewayConnected: false,
    selectedIndex: 0,
    selectionNumber: 1,
    selectedTitle: asciiBytes("The Fifth Element"),
  };
}

function titleFor(index: number): Uint8Array {
  switch (index) {
    case 0:
      return asciiBytes("The Fifth Element");
    case 1:
      return asciiBytes("Alien");
    case 2:
      return asciiBytes("Spirited Away");
    case 3:
      return asciiBytes("Twin Peaks");
  }
  return asciiBytes("The Fifth Element");
}

export function update(model: Model, msg: Msg): Model {
  switch (msg.kind) {
    case "connect_demo":
      return { ...model, screen: "home", gatewayConnected: true };
    case "previous": {
      const selectedIndex = model.selectedIndex === 0 ? 3 : model.selectedIndex - 1;
      return {
        ...model,
        selectedIndex: selectedIndex,
        selectionNumber: selectedIndex + 1,
        selectedTitle: titleFor(selectedIndex),
      };
    }
    case "next": {
      const selectedIndex = model.selectedIndex === 3 ? 0 : model.selectedIndex + 1;
      return {
        ...model,
        selectedIndex: selectedIndex,
        selectionNumber: selectedIndex + 1,
        selectedTitle: titleFor(selectedIndex),
      };
    }
    case "open":
      if (!model.gatewayConnected) return model;
      return { ...model, screen: "details" };
    case "back":
      if (model.screen === "details") return { ...model, screen: "home" };
      return model;
  }
}
