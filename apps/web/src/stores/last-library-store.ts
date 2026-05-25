import { create } from "zustand";
import { devtools } from "zustand/middleware";

/**
 * Remembers the last library route (pathname + search) the user visited so
 * the mobile "Libraries" tab can return them to where they left off instead
 * of always snapping back to the first pinned library.
 *
 * The state is intentionally in-memory only — it persists across client-side
 * navigations within a session but resets on a full page reload, at which
 * point the tab falls back to the first pinned library.
 */
interface LastLibraryStore {
  href: string | null;
  setHref: (href: string) => void;
  clearHref: () => void;
}

export const useLastLibraryStore = create<LastLibraryStore>()(
  devtools(
    (set) => ({
      href: null,
      setHref: (href) => set({ href }),
      clearHref: () => set({ href: null }),
    }),
    { name: "last-library-store" },
  ),
);
