import {
  getMetadataSummaryLines,
  getSeasonEpisodeIndices,
  type ItemMetadata,
} from "@multiplex/plex-query";

import { EpisodeSeasonIndex } from "./episode-season-index";

interface MetadataSummaryRowProps {
  item: ItemMetadata;
  serverId: string;
}

export function MetadataSummaryRow({
  item,
  serverId,
}: MetadataSummaryRowProps) {
  const lines = getMetadataSummaryLines(item);
  const hasEpisodeIndex =
    item.type === "episode" &&
    getSeasonEpisodeIndices(item.parentIndex, item.index) !== undefined;

  if (lines.length === 0 && !hasEpisodeIndex) {
    return null;
  }

  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
      {lines.map((value) => (
        <span key={value}>{value}</span>
      ))}
      <EpisodeSeasonIndex item={item} serverId={serverId} />
    </div>
  );
}
