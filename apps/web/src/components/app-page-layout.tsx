import type { ReactNode } from "react";

import { AppHeader } from "~/components/app-header";
import { AppPageContent } from "~/components/app-page-content";

interface AppPageLayoutProps {
  title: ReactNode;
  mobileHeader?: ReactNode;
  children: ReactNode;
  spacing?: "home" | "default";
}

export function AppPageLayout({
  title,
  mobileHeader,
  children,
  spacing = "default",
}: AppPageLayoutProps) {
  return (
    <>
      <AppHeader mobile={mobileHeader}>{title}</AppHeader>
      <AppPageContent spacing={spacing}>{children}</AppPageContent>
    </>
  );
}
