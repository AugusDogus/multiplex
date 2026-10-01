"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import * as React from "react";
import { CustomThemeStyles } from "~/components/custom-theme-styles";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider {...props}>
      <CustomThemeStyles />
      {children}
    </NextThemesProvider>
  );
}
