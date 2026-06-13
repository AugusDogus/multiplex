import type { Hub, HubItem } from "../schemas/hub-schemas";
import { formatSeasonEpisodeLabel, getMetadataTypeLabel } from "./metadata-utils";

const CONTINUE_HUB_PATTERNS = [".continue", ".inprogress", "home.ondeck"];

export function isContinueWatchingHub(hubIdentifier: string): boolean {
  return CONTINUE_HUB_PATTERNS.some((pattern) => hubIdentifier.includes(pattern));
}

export function filterBrowsableHubs(hubs: Hub[]): Hub[] {
  return hubs.filter(
    (hub) => !isContinueWatchingHub(hub.hubIdentifier) && hub.size > 0 && hub.items.length > 0,
  );
}

/**
 * Like {@link filterBrowsableHubs} but keeps Continue Watching hubs. Used by
 * the library Recommended tab, which leads with Continue Watching the way the
 * official Plex client does.
 */
export function filterNonEmptyHubs(hubs: Hub[]): Hub[] {
  return hubs.filter((hub) => hub.size > 0 && hub.items.length > 0);
}

export function getHubItemTitle(item: HubItem): string {
  if (item.type === "episode" && item.grandparentTitle) {
    return item.grandparentTitle;
  }

  return item.title;
}

export function getHubItemSubtitle(item: HubItem): string {
  if (item.type === "episode") {
    const seasonEpisode = formatSeasonEpisodeLabel(item.parentIndex, item.index);
    const parts = [item.title, seasonEpisode].filter(Boolean);
    return parts.join(" · ");
  }

  if (item.type === "show" && item.year) {
    return item.year.toString();
  }

  if (item.type === "movie" && item.year) {
    return item.year.toString();
  }

  const typeLabel = getMetadataTypeLabel(item.type);
  if (item.year) {
    return `${typeLabel} · ${item.year}`;
  }

  return typeLabel;
}
