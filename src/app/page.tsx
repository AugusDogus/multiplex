import { redirect } from "next/navigation";

import { headers } from "next/headers";
import { LatestPost } from "~/app/_components/post";
import { auth } from "~/lib/auth/server";
import { api, HydrateClient } from "~/trpc/server";

export default async function Home() {
  const hello = await api.plex.hello({ text: "from tRPC" });

  void api.plex.getLatest.prefetch();

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  return (
    <HydrateClient>
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
        <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
          <h1 className="text-5xl font-extrabold tracking-tight sm:text-[5rem]">
            <span className="text-[hsl(280,100%,70%)]">Multiplex</span>
          </h1>
          <p className="max-w-2xl text-center text-xl">
            Watch your favorite movies and TV shows with friends in perfect
            synchronization across all devices
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-8">
            <div className="flex max-w-xs flex-col gap-4 rounded-xl bg-white/10 p-4">
              <h3 className="text-2xl font-bold">🎬 Synchronized Playback</h3>
              <div className="text-lg">
                Watch together in real-time with automatic sync across all
                connected devices.
              </div>
            </div>
            <div className="flex max-w-xs flex-col gap-4 rounded-xl bg-white/10 p-4">
              <h3 className="text-2xl font-bold">🎮 Real-time Controls</h3>
              <div className="text-lg">
                Play, pause, seek, and navigate together with your friends
                seamlessly.
              </div>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <p className="text-2xl text-white">
              {hello ? hello.greeting : "Loading tRPC query..."}
            </p>
          </div>

          <LatestPost />
        </div>
      </main>
    </HydrateClient>
  );
}
