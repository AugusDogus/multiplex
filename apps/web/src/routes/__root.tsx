import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";

import Header from "../components/Header";
import { ThemeProvider } from "tanstack-theme-kit";

import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import { getStoredToken } from "../lib/auth/token-storage";

import appCss from "../styles.css?url";

import type { QueryClient } from "@tanstack/react-query";

interface MyRouterContext {
  queryClient: QueryClient;
}

// Routes that don't require authentication
const PUBLIC_ROUTES = ["/login"];

export const Route = createRootRouteWithContext<MyRouterContext>()({
  beforeLoad: ({ location }) => {
    const isPublicRoute = PUBLIC_ROUTES.some((route) => location.pathname === route);

    // Skip auth check for public routes
    if (isPublicRoute) {
      return;
    }

    // Check for auth token
    const token = getStoredToken();
    if (!token) {
      throw redirect({
        to: "/login",
      });
    }
  },

  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Multiplex",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),

  component: RootComponent,
  shellComponent: RootDocument,
});

function RootComponent() {
  const location = useLocation();
  const isLoginPage = location.pathname === "/login";

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {!isLoginPage && <Header />}
      <Outlet />
    </ThemeProvider>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
            TanStackQueryDevtools,
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}
