import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ConsoleLinkForm } from "~/components/console-link-form";
import { auth } from "~/lib/auth/server";

export default async function LinkConsolePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user.plexAuthToken) {
    redirect("/login?returnTo=%2Flink");
  }

  return (
    <main className="bg-background relative flex min-h-svh items-center justify-center overflow-hidden px-6 py-12">
      <div
        aria-hidden="true"
        className="bg-primary/4 pointer-events-none absolute top-1/2 left-1/2 size-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl dark:bg-white/3"
      />
      <ConsoleLinkForm />
    </main>
  );
}
