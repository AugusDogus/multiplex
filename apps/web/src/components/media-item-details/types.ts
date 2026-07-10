import type { ItemDetails as BridgeItemDetails } from "~/lib/effect/plex-boundary";

/** Stable export name — aliases the Effect bridge composite. */
export type ItemDetails = BridgeItemDetails;
export type EnrichedChildMetadata = ItemDetails["children"][number];
export type PlayableChildMetadata = ItemDetails["playableChildren"][number];
export type PlayTarget = ItemDetails["playTarget"];

export interface MediaItemDetailsProps {
  details: ItemDetails;
  serverId: string;
}

export interface MediaServerContext {
  serverId: string;
  serverUrl: string | undefined;
  authToken: string | undefined;
}
