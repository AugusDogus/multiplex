import "~/styles/globals.css";

import { type Metadata } from "next";
import { StrictMode } from "react";

import { MediaPlayerModalLazy } from "~/components/media-player-modal-lazy";
import { ThemeBoot } from "~/components/theme-boot";
import { ThemeProvider } from "~/components/theme-provider";
import { ToastProvider } from "~/components/ui/toast";
import { TooltipProvider } from "~/components/ui/tooltip";
import { EffectRegistryProvider } from "~/lib/effect";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
  title: "Multiplex",
  description: "A 3rd party Plex client for synchronized watching with friends",
  icons: [{ rel: "icon", url: "/favicon.svg" }],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeBoot />
      </head>
      <body>
        <StrictMode>
          <TRPCReactProvider>
            <EffectRegistryProvider>
              <ThemeProvider
                attribute="class"
                defaultTheme="system"
                enableSystem
                disableTransitionOnChange
              >
                <ToastProvider>
                  <TooltipProvider>
                    {children}
                    <MediaPlayerModalLazy />
                  </TooltipProvider>
                </ToastProvider>
              </ThemeProvider>
            </EffectRegistryProvider>
          </TRPCReactProvider>
        </StrictMode>
      </body>
    </html>
  );
}
