import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import SuperJSON from "superjson";

import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../web/src/server/api/root";

import { getBaseUrl } from "~/lib/base-url";

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export const api = createTRPCReact<AppRouter>();

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  });
}

export function createApiClient(accessToken: string) {
  return createTRPCClient<AppRouter>({
    links: [
      loggerLink({
        enabled: (operation) =>
          process.env.NODE_ENV === "development" ||
          (operation.direction === "down" && operation.result instanceof Error),
      }),
      httpBatchLink({
        transformer: SuperJSON,
        url: `${getBaseUrl()}/api/trpc`,
        headers: {
          authorization: `Bearer ${accessToken}`,
          "x-trpc-source": "expo-react",
        },
      }),
    ],
  });
}
