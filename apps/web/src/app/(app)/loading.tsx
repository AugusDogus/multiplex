import { AppHeaderSkeleton } from "~/components/app-header-skeleton";
import { AppPageContent } from "~/components/app-page-content";
import { HomeContentSkeleton } from "~/components/home-content-skeleton";

export default function Loading() {
  return (
    <>
      <AppHeaderSkeleton showBreadcrumb={false} />
      <AppPageContent spacing="home">
        <HomeContentSkeleton />
      </AppPageContent>
    </>
  );
}
