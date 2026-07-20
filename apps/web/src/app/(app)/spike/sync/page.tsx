import { AppHeader } from "~/components/app-header";
import { AppPageContent } from "~/components/app-page-content";
import { SyncEngineSpikeClient } from "~/components/sync-engine-spike-client";

/**
 * TanStack DB sync-engine spike demo.
 * Proves OPFS-persisted collections + live queries for shell Plex data.
 */
export default function SyncEngineSpikePage() {
  return (
    <>
      <AppHeader />
      <AppPageContent spacing="default">
        <SyncEngineSpikeClient />
      </AppPageContent>
    </>
  );
}
