import type { RouterOutputs } from "~/trpc/api";

export type ItemDetails = NonNullable<RouterOutputs["plex"]["getItemDetails"]>;
export type EnrichedChildMetadata = ItemDetails["children"][number];
export type PlayableChildMetadata = ItemDetails["playableChildren"][number];
export type PlayTarget = ItemDetails["playTarget"];

export interface MediaItemDetailsProps {
  details: ItemDetails;
  serverId: string;
}

export interface MediaServerContext {
  serverId: string;
}
