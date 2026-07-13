import type { Metadata } from "next";
import { Suspense } from "react";

import { GuestWatchTogetherPage } from "~/components/watch-together/guest-watch-together-page";

export const metadata: Metadata = {
  title: "Join Watch Together · Multiplex",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function GuestWatchTogetherRoute({
  params,
}: {
  params: Promise<{ capability: string }>;
}) {
  return (
    <Suspense fallback={<GuestRouteLoading />}>
      <GuestWatchTogetherRouteContent params={params} />
    </Suspense>
  );
}

async function GuestWatchTogetherRouteContent({
  params,
}: {
  params: Promise<{ capability: string }>;
}) {
  const { capability } = await params;
  return <GuestWatchTogetherPage capability={capability} />;
}

function GuestRouteLoading() {
  return (
    <main className="text-muted-foreground flex min-h-svh items-center justify-center px-5 text-sm">
      Loading Watch Together invite…
    </main>
  );
}
