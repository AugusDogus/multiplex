export function GuestPageFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 px-5 py-10">
      {children}
    </main>
  );
}
