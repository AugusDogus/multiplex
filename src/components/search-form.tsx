"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/button";
import { SidebarInput } from "~/components/ui/sidebar";
import { useIsMobile } from "~/hooks/use-mobile";

interface SearchFormProps extends React.ComponentProps<"div"> {
  onSearchClick: () => void;
}

export function SearchForm({ onSearchClick, ...props }: SearchFormProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div {...props}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onSearchClick}
          className="h-8 w-8 p-0"
        >
          <Search className="h-4 w-4" />
          <span className="sr-only">Search</span>
        </Button>
      </div>
    );
  }

  return (
    <div {...props}>
      <div 
        className="relative cursor-pointer"
        onClick={onSearchClick}
      >
        <Label htmlFor="search" className="sr-only">
          Search
        </Label>
        <SidebarInput
          id="search"
          placeholder="Search media..."
          className="h-8 pl-7 cursor-pointer"
          readOnly
        />
        <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-50 select-none" />
      </div>
    </div>
  );
}
