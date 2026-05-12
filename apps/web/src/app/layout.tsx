import "~/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";

import { MediaPlayerModal } from "~/components/media-player";
import { ThemeProvider } from "~/components/theme-provider";
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
        <TRPCReactProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
            <MediaPlayerModal />
          </ThemeProvider>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
