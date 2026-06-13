import { AppHeaderSkeleton } from "~/components/app-header-skeleton";
import { AppPageContent } from "~/components/app-page-content";
import { HubPageSkeleton } from "~/components/hub-page-skeleton";

export default function HubPageLoading() {
  return (
    <>
      <AppHeaderSkeleton />
      <AppPageContent>
        <HubPageSkeleton />
      </AppPageContent>
    </>
  );
}
