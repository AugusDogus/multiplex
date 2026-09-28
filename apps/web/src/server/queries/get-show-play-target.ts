import {
  enrichMetadataChildren,
  getPlayableChildren,
  resolvePlayTarget,
  type EnrichedItemMetadataChild,
  type ItemMetadata,
  type PlayableMetadata,
  type PlexServerClient,
} from "@multiplex/plex-query";

type PlayTargetResolution =
  | { playTarget: PlayableMetadata | null; playTargetError: null }
  | {
      playTarget: null;
      playTargetError: {
        code: "EPISODE_LOOKUP_FAILED";
        seasonRatingKey: string;
        message: string;
      };
    };

/** Find the earliest episode without making show browsing depend on episode discovery. */
export async function getShowPlayTarget(
  serverClient: Pick<PlexServerClient, "getMetadataChildren">,
  item: ItemMetadata,
  children: EnrichedItemMetadataChild[],
): Promise<PlayTargetResolution> {
  const seasons = children
    .filter((child) => child.type === "season")
    .sort(
      (a, b) =>
        (a.index === 0 ? Number.MAX_SAFE_INTEGER : (a.index ?? 1)) -
        (b.index === 0 ? Number.MAX_SAFE_INTEGER : (b.index ?? 1)),
    );

  const loadSeason = async (
    season: EnrichedItemMetadataChild,
  ): Promise<PlayTargetResolution> => {
    try {
      const episodes = enrichMetadataChildren(
        await serverClient.getMetadataChildren(season.ratingKey),
        item,
      );
      return {
        playTarget: resolvePlayTarget(season, getPlayableChildren(episodes)),
        playTargetError: null,
      };
    } catch {
      return {
        playTarget: null,
        playTargetError: {
          code: "EPISODE_LOOKUP_FAILED",
          seasonRatingKey: season.ratingKey,
          message:
            "Could not load an episode to play. Your show details are still available. Open a season to choose an episode.",
        },
      };
    }
  };

  const [firstSeason, ...remainingSeasons] = seasons;
  if (!firstSeason) return { playTarget: null, playTargetError: null };

  const first = await loadSeason(firstSeason);
  if (first.playTarget || first.playTargetError) return first;

  // Start fallback requests together, but consume them in season order. Each
  // promise resolves to a value, so unused later failures cannot go unhandled.
  async function* loadFallbackSeasons() {
    yield* remainingSeasons.map(loadSeason);
  }
  for await (const result of loadFallbackSeasons()) {
    if (result.playTarget || result.playTargetError) return result;
  }
  return { playTarget: null, playTargetError: null };
}
