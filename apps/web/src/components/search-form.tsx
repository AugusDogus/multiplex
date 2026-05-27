"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/button";
import { SidebarInput } from "~/components/ui/sidebar";

interface SearchFormProps extends React.ComponentProps<"div"> {
  onSearchClick: () => void;
}

export function SearchForm({ onSearchClick, ...props }: SearchFormProps) {
  const [isMac, setIsMac] = React.useState(false);

  React.useEffect(() => {
    setIsMac(
      typeof navigator !== "undefined" &&
        /Mac|iPhone|iPad|iPod/.test(navigator.platform),
    );
  }, []);

  return (
    <div {...props}>
      {/* Mobile: Show search button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onSearchClick}
        className="h-8 w-8 p-0 md:hidden"
      >
        <Search className="h-4 w-4" />
        <span className="sr-only">Search</span>
      </Button>

      {/* Desktop: Show search input */}
      <div
        className="relative hidden cursor-pointer md:block"
        onClick={onSearchClick}
      >
        <Label htmlFor="search" className="sr-only">
          Search
        </Label>
        <SidebarInput
          id="search"
          placeholder="Search media..."
          className="h-8 cursor-pointer pr-12 pl-7"
          readOnly
        />
        <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-50 select-none" />
        <kbd className="bg-muted text-foreground ring-border pointer-events-none absolute top-1/2 right-1.5 hidden h-5 min-w-5 shrink-0 -translate-y-1/2 items-center justify-center rounded-sm px-1.5 text-center font-sans text-xs leading-[1.7em] ring-1 select-none sm:flex">
          <span>{isMac ? "⌘ K" : "Ctrl K"}</span>
        </kbd>
      </div>
    </div>
  );
}
