import Link from "next/link";
import {
  getSeasonEpisodeIndices,
  type ItemMetadata,
} from "@multiplex/plex-query";

import { getItemDetailsHref } from "~/lib/plex-routes";

interface EpisodeSeasonIndexProps {
  item: ItemMetadata;
  serverId: string;
}

export function EpisodeSeasonIndex({
  item,
  serverId,
}: EpisodeSeasonIndexProps) {
  if (item.type !== "episode") {
    return null;
  }

  const numbers = getSeasonEpisodeIndices(item.parentIndex, item.index);
  if (!numbers) {
    return null;
  }

  const seasonLabel = `S${numbers.season}`;

  return (
    <span>
      {item.parentRatingKey ? (
        <Link
          href={getItemDetailsHref(serverId, item.parentRatingKey)}
          className="hover:text-foreground transition-colors"
        >
          {seasonLabel}
        </Link>
      ) : (
        seasonLabel
      )}{" "}
      E{numbers.episode}
    </span>
  );
}
