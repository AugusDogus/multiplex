import "~/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";
import { StrictMode } from "react";

import { MediaPlayerModal } from "~/components/media-player";
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

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable}`} suppressHydrationWarning>
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
                    <MediaPlayerModal />
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
