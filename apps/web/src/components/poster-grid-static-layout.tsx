import type { ReactNode } from "react";

export function PosterGridStaticLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(160px,100%),1fr))] justify-items-center gap-x-3 gap-y-5 sm:gap-x-4">
      {children}
    </div>
  );
}
