import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ConsoleLinkForm } from "~/components/console-link-form";
import { Spinner } from "~/components/ui/spinner";
import { auth } from "~/lib/auth/server";

function normalizeUserCode(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return (candidate ?? "")
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]/g, "")
    .slice(0, 4);
}

async function LinkConsoleContent({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string | string[] }>;
}) {
  const code = normalizeUserCode((await searchParams).user_code);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user.plexAuthToken) {
    const returnTo =
      code.length === 4
        ? `/link?user_code=${encodeURIComponent(code)}`
        : "/link";
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return <ConsoleLinkForm initialCode={code} />;
}

export default function LinkConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string | string[] }>;
}) {
  return (
    <main className="bg-background relative flex min-h-svh items-center justify-center overflow-hidden px-6 py-12">
      <div
        aria-hidden="true"
        className="bg-primary/4 pointer-events-none absolute top-1/2 left-1/2 size-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl dark:bg-white/3"
      />
      <Suspense fallback={<Spinner className="text-muted-foreground size-5" />}>
        <LinkConsoleContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
