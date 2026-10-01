import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { auth } from "~/lib/auth/server";
import { SettingsShell } from "~/components/settings/settings-shell";
import { Spinner } from "~/components/ui/spinner";

async function AuthenticatedSettings({ children }: { children: ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?returnTo=%2Fsettings%2Fappearance");
  return <SettingsShell>{children}</SettingsShell>;
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh items-center justify-center">
          <Spinner aria-label="Loading settings" />
        </div>
      }
    >
      <AuthenticatedSettings>{children}</AuthenticatedSettings>
    </Suspense>
  );
}
