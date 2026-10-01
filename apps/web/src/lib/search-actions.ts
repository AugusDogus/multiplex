export type SearchAction = {
  id: string;
  label: string;
  keywords: string;
} & (
  | { kind: "navigate"; href: string; icon: "home" | "watchlist" | "settings" }
  | { kind: "theme"; theme: "light" | "dark" | "system" }
);

const actions: readonly SearchAction[] = [
  {
    id: "home",
    label: "Go to Home",
    keywords: "navigation library",
    kind: "navigate",
    href: "/",
    icon: "home",
  },
  {
    id: "watchlist",
    label: "Open Watchlist",
    keywords: "navigation saved watch later",
    kind: "navigate",
    href: "/media/myPlex/tv.plex.provider.discover?source=watchlist",
    icon: "watchlist",
  },
  {
    id: "appearance",
    label: "Appearance settings",
    keywords: "preferences colors themes install",
    kind: "navigate",
    href: "/settings/appearance",
    icon: "settings",
  },
  {
    id: "light",
    label: "Use light mode",
    keywords: "theme appearance",
    kind: "theme",
    theme: "light",
  },
  {
    id: "dark",
    label: "Use dark mode",
    keywords: "theme appearance",
    kind: "theme",
    theme: "dark",
  },
  {
    id: "system",
    label: "Use system theme",
    keywords: "mode appearance automatic device",
    kind: "theme",
    theme: "system",
  },
];

export const SearchAction = {
  matching(query: string): readonly SearchAction[] {
    const words = query.trim().toLowerCase().split(/\s+/);
    return actions.filter((action) => {
      const text = `${action.label} ${action.keywords}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  },
} as const;
