import { createFileRoute } from "@tanstack/react-router";
import { useLayoutData } from "../contexts/layout-data-context";
import { ContinueWatching } from "../components/continue-watching";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  // Get data from the layout context - no additional fetching needed
  const { continueWatchingItems, isAllDataLoading, continueWatchingError } = useLayoutData();

  return (
    <div className="flex flex-col gap-8 py-4">
      <ContinueWatching
        items={continueWatchingItems}
        isLoading={isAllDataLoading}
        error={continueWatchingError}
      />
    </div>
  );
}
