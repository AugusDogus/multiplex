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
    <div className="text-foreground/65 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {lines.map((value) => (
        <span key={value}>{value}</span>
      ))}
      <EpisodeSeasonIndex item={item} serverId={serverId} />
    </div>
  );
}
