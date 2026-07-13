import { WatchTogetherSessionShell } from "~/components/watch-together/watch-together-session-shell";

export default function WatchTogetherLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <WatchTogetherSessionShell>{children}</WatchTogetherSessionShell>;
}
