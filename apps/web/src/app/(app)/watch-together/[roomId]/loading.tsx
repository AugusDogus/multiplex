import { AppHeader } from "~/components/app-header";
import { AppPageContent } from "~/components/app-page-content";

/**
 * Route-level loading UI for Watch Together lobbies.
 *
 * Without this file, soft-navigating from home/item details into
 * `/watch-together/[roomId]` falls through to `(app)/loading.tsx`, which
 * renders the home content skeleton — a visible "flash of home" before the
 * lobby appears.
 */
export default function WatchTogetherRoomLoading() {
  return (
    <>
      <AppHeader>Watch Together</AppHeader>
      <AppPageContent>
        <div className="text-muted-foreground flex min-h-64 items-center justify-center rounded-2xl border p-8 text-sm">
          Loading Watch Together room...
        </div>
      </AppPageContent>
    </>
  );
}
