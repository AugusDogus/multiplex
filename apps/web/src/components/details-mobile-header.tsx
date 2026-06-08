"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface DetailsMobileHeaderProps {
  title: string;
  subtitle?: string;
  backHref?: string;
}

interface DetailsBackButtonProps {
  href?: string;
  onClick?: () => void;
}

function DetailsBackButton({ href, onClick }: DetailsBackButtonProps) {
  if (href) {
    return (
      <Link
        href={href}
        aria-label="Go back"
        className="text-foreground active:bg-accent/60 -ml-1 flex size-9 shrink-0 items-center justify-center rounded-md"
      >
        <ChevronLeft className="size-5" />
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Go back"
      className="text-foreground active:bg-accent/60 -ml-1 flex size-9 shrink-0 items-center justify-center rounded-md"
    >
      <ChevronLeft className="size-5" />
    </button>
  );
}

export function DetailsMobileHeader({
  title,
  subtitle,
  backHref,
}: DetailsMobileHeaderProps) {
  const router = useRouter();

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <DetailsBackButton
        href={backHref}
        onClick={backHref ? undefined : () => router.back()}
      />
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
