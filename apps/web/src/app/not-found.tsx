import Link from "next/link";

/**
 * Real 404 page — unknown routes must not fall through to the app shell
 * skeleton while auth/data resolve.
 */
export default function NotFound() {
  return (
    <main className="bg-background text-foreground flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <p className="text-muted-foreground text-sm tracking-[0.2em] uppercase">
        404
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted-foreground max-w-sm text-center text-sm">
        That route does not exist in Multiplex.
      </p>
      <Link
        href="/"
        className="text-primary text-sm font-medium underline-offset-4 hover:underline"
      >
        Back to home
      </Link>
    </main>
  );
}
