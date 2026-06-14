"use client";

import { useSearchParams } from "next/navigation";

import { LibraryPivotSkeleton } from "~/components/library-pivot-skeleton";
import { isSupportedPivot } from "~/lib/library-constants";

export function LibraryPivotContentSkeleton() {
  const searchParams = useSearchParams();
  const requestedPivot = searchParams.get("pivot") ?? "recommended";
  const pivot = isSupportedPivot(requestedPivot) ? requestedPivot : "recommended";

  return <LibraryPivotSkeleton pivot={pivot} />;
}
