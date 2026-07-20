"use client";

import { createTRPCClient, type TRPCClient } from "@trpc/client";

import type { AppRouter } from "~/server/api/root";
import { createTrpcClientLinks } from "~/trpc/client-links";

let browserClient: TRPCClient<AppRouter> | undefined;

/** Vanilla tRPC client for sync-engine queryFns (not React hooks). */
export function getSyncEngineTrpcClient(): TRPCClient<AppRouter> {
  browserClient ??= createTRPCClient<AppRouter>({
    links: createTrpcClientLinks("tanstack-db-sync-engine"),
  });
  return browserClient;
}
