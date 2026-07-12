"use client";

import { createContext, type ReactNode, useContext, useState } from "react";

import { SidebarInset } from "~/components/ui/sidebar";

const AppScrollElementContext = createContext<HTMLElement | null>(null);

export function useAppScrollElement() {
  return useContext(AppScrollElementContext);
}

interface AppScrollContainerProps {
  children: ReactNode;
}

export function AppScrollContainer({ children }: AppScrollContainerProps) {
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const scrollRef = (node: HTMLElement | null) => {
    setScrollElement((current) => (current === node ? current : node));
  };

  return (
    <AppScrollElementContext.Provider value={scrollElement}>
      <SidebarInset
        ref={scrollRef}
        className="h-svh w-0 max-w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-none md:h-[calc(100svh-1rem)]"
      >
        {children}
      </SidebarInset>
    </AppScrollElementContext.Provider>
  );
}
