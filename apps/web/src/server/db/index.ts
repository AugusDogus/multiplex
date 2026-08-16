import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { env } from "~/env";
import * as schema from "./schema";

/**
 * Cache the database connection in development. This avoids creating a new connection on every HMR
 * update.
 */
declare global {
  var multiplexDbClient: Client | undefined;
}

export const client =
  globalThis.multiplexDbClient ?? createClient({ url: env.DATABASE_URL });
if (env.NODE_ENV !== "production") globalThis.multiplexDbClient = client;

export const db = drizzle(client, { schema });
