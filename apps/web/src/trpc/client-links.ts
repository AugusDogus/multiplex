import { httpBatchStreamLink, loggerLink, type TRPCLink } from "@trpc/client";
import SuperJSON from "superjson";

import type { AppRouter } from "~/server/api/root";

export function createTrpcClientLinks(source: string): TRPCLink<AppRouter>[] {
  return [
    loggerLink({
      enabled: (op) =>
        process.env.NODE_ENV === "development" ||
        (op.direction === "down" && op.result instanceof Error),
    }),
    httpBatchStreamLink({
      transformer: SuperJSON,
      url: getBaseUrl() + "/api/trpc",
      headers: () => {
        const headers = new Headers();
        headers.set("x-trpc-source", source);
        return headers;
      },
    }),
  ];
}

function getBaseUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}
