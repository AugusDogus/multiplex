import type { ReactNode } from "react";

export function PosterGridStaticLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(120px,100%),1fr))] justify-items-center gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-x-4 md:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
      {children}
    </div>
  );
}
