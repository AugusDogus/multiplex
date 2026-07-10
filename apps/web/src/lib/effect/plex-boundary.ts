/**
 * Typed boundary helpers for permissive HttpApi success schemas.
 *
 * Phase 5-1a documents the tradeoff: large Plex metadata trees stay
 * `Schema.Unknown` on the wire because plex-query already zod-validates
 * server-side. Call sites that need the plex-query TypeScript shapes must go
 * through these helpers instead of sprinkling `as` casts.
 *
 * @module plex-boundary
 */
import type {
  ItemMetadata,
  PlayQueueResponse,
  WatchTogetherRoom,
} from "@multiplex/plex-query";

import type { RouterOutputs } from "~/trpc/react";

/** Composite returned by `library.getItemDetails` (same shape as the tRPC query). */
export type ItemDetails = NonNullable<RouterOutputs["plex"]["getItemDetails"]>;

/**
 * Assert a wire `unknown` as plex-query `ItemMetadata`.
 * Server already zod-validated via plex-query before encoding.
 */
export const asItemMetadata = (value: unknown): ItemMetadata =>
  value as ItemMetadata;

/**
 * Assert a wire `unknown` as the getItemDetails composite (or null).
 * Server already zod-validated via plex-query before encoding.
 */
export const asItemDetails = (value: unknown): ItemDetails | null =>
  value as ItemDetails | null;

/**
 * Assert a wire `unknown` as plex-query `PlayQueueResponse`.
 * Server already zod-validated via plex-query before encoding.
 */
export const asPlayQueue = (value: unknown): PlayQueueResponse =>
  value as PlayQueueResponse;

/**
 * Assert Effect Schema / wire room objects as plex-query `WatchTogetherRoom`.
 * Field shapes match; Effect's readonly arrays are compatible at runtime.
 */
export const asWatchTogetherRoom = (value: unknown): WatchTogetherRoom =>
  value as WatchTogetherRoom;

export const asWatchTogetherRooms = (value: unknown): WatchTogetherRoom[] =>
  value as WatchTogetherRoom[];
