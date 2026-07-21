"use client";

import {
  resetContinueWatchingProgress,
  updateContinueWatchingProgress,
} from "~/lib/continue-watching-progress";

import { upsertRow } from "./collections";
import { getActiveSyncEngineCollections } from "./registry";
import type { SanitizedContinueWatchingRow } from "./sanitize";

function toProgressItem(row: SanitizedContinueWatchingRow) {
  return {
    serverId: row.serverId,
    ratingKey: row.ratingKey,
    duration: row.duration ?? undefined,
    viewOffset: row.viewOffset ?? undefined,
    progressPercent: row.progressPercent ?? undefined,
    isCompleted: row.isCompleted ?? undefined,
    timeRemaining: row.timeRemaining ?? undefined,
  };
}

export function patchSyncedContinueWatchingProgress(
  identity: { serverId: string; ratingKey: string },
  timeSeconds: number,
  durationSeconds: number,
): void {
  const collections = getActiveSyncEngineCollections();
  if (!collections) return;

  const id = `${identity.serverId}:${identity.ratingKey}`;
  const current = collections.continueWatching.get(id) as
    | SanitizedContinueWatchingRow
    | undefined;
  if (!current) return;

  const [updated] =
    updateContinueWatchingProgress(
      [toProgressItem(current)],
      identity,
      timeSeconds,
      durationSeconds,
    ) ?? [];
  if (!updated) return;

  void upsertRow(collections.continueWatching, {
    ...current,
    duration: updated.duration ?? null,
    viewOffset: updated.viewOffset ?? null,
    progressPercent: updated.progressPercent ?? null,
    isCompleted: updated.isCompleted ?? null,
    timeRemaining: updated.timeRemaining ?? null,
  });
}

export function resetSyncedContinueWatchingProgress(identity: {
  serverId: string;
  ratingKey: string;
}): void {
  const collections = getActiveSyncEngineCollections();
  if (!collections) return;

  const id = `${identity.serverId}:${identity.ratingKey}`;
  const current = collections.continueWatching.get(id) as
    | SanitizedContinueWatchingRow
    | undefined;
  if (!current) return;

  const [updated] =
    resetContinueWatchingProgress([toProgressItem(current)], identity) ?? [];
  if (!updated) return;

  void upsertRow(collections.continueWatching, {
    ...current,
    duration: updated.duration ?? null,
    viewOffset: updated.viewOffset ?? null,
    progressPercent: updated.progressPercent ?? null,
    isCompleted: updated.isCompleted ?? null,
    timeRemaining: updated.timeRemaining ?? null,
  });
}
