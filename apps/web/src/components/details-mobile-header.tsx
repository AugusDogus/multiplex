"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface DetailsMobileHeaderProps {
  title: string;
  subtitle?: string;
  backHref?: string;
}

export function DetailsMobileHeader({
  title,
  subtitle,
  backHref,
}: DetailsMobileHeaderProps) {
  const router = useRouter();

  const backButton = backHref ? (
    <Link
      href={backHref}
      aria-label="Go back"
      className="text-foreground active:bg-accent/60 flex size-10 shrink-0 items-center justify-center rounded-md"
    >
      <ChevronLeft className="size-6" />
    </Link>
  ) : (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Go back"
      className="text-foreground active:bg-accent/60 flex size-10 shrink-0 items-center justify-center rounded-md"
    >
      <ChevronLeft className="size-6" />
    </button>
  );

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 py-1">
      {backButton}
      <div className="grid min-w-0 flex-1 leading-tight">
        <span className="truncate text-base font-semibold tracking-tight">
          {title}
        </span>
        {subtitle && (
          <span className="text-muted-foreground truncate text-xs">
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}
