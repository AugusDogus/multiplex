import { describe, expect, test } from "bun:test";

import type { SyncEngineCollections } from "./collections";
import { resolveSyncEngineCollections } from "./collection-access";

const collections = {} as SyncEngineCollections;
const otherCollections = {} as SyncEngineCollections;

describe("resolveSyncEngineCollections", () => {
  test("uses the active account registry outside the provider tree", () => {
    expect(resolveSyncEngineCollections(null, collections)).toBe(collections);
  });

  test("keeps guest root consumers disconnected without an active registry", () => {
    expect(resolveSyncEngineCollections(null, null)).toBeNull();
  });

  test("does not expose collections while an in-tree provider is booting", () => {
    expect(
      resolveSyncEngineCollections({ phase: "booting" }, collections),
    ).toBeNull();
  });

  test("rejects a stale registry that differs from the ready provider", () => {
    expect(
      resolveSyncEngineCollections(
        { phase: "ready", collections, bootedAt: 1 },
        otherCollections,
      ),
    ).toBeNull();
  });
});
