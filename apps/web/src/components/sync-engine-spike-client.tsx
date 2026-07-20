"use client";

import { useState, useTransition } from "react";

import {
  useNavigatorOnline,
  useSyncedContinueWatching,
  useSyncedHomeHubs,
  useSyncedMediaItems,
  useSyncedServerLibraries,
  useSyncedServers,
  useSyncEngineCollections,
  useSyncEngineStatus,
  warmMediaItem,
} from "~/lib/sync-engine";
import { getSyncEngineTrpcClient } from "~/lib/sync-engine/trpc-client";

export function SyncEngineSpikeClient() {
  const status = useSyncEngineStatus();
  const online = useNavigatorOnline();
  const collections = useSyncEngineCollections();
  const servers = useSyncedServers();
  const continueWatching = useSyncedContinueWatching();
  const hubs = useSyncedHomeHubs();
  const libraries = useSyncedServerLibraries();
  const mediaItems = useSyncedMediaItems();
  const [warmError, setWarmError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const markFirstComplete = () => {
    const first = continueWatching.data[0];
    if (!first || !collections) return;
    collections.continueWatching.update(first.id, (draft) => {
      draft.isCompleted = true;
      draft.progressPercent = 100;
    });
  };

  const warmFirstItem = () => {
    const first = continueWatching.data[0];
    if (!first || !collections) return;
    setWarmError(null);
    startTransition(async () => {
      try {
        await warmMediaItem(collections, getSyncEngineTrpcClient(), {
          serverId: first.serverId,
          ratingKey: first.ratingKey,
        });
      } catch (error) {
        setWarmError(
          error instanceof Error ? error.message : "Failed to warm item",
        );
      }
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 py-6">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm tracking-wide uppercase">
          Spike
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          TanStack DB sync engine
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Local OPFS SQLite replica of shell Plex data. First load syncs in the
          background; reloads and soft-nav should paint from the durable cache
          instantly. Tokens are stripped before persistence.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <StatusCard
          label="Engine"
          value={
            status.phase === "ready"
              ? "ready"
              : status.phase === "error"
                ? "error"
                : "booting"
          }
          detail={
            status.phase === "error"
              ? status.error
              : status.phase === "ready"
                ? `booted ${new Date(status.bootedAt).toLocaleTimeString()}`
                : "opening OPFS SQLite…"
          }
        />
        <StatusCard
          label="Network"
          value={online ? "online" : "offline"}
          detail={
            online
              ? "background refetch enabled"
              : "serving persisted local rows"
          }
        />
        <StatusCard
          label="Local rows"
          value={String(
            servers.data.length +
              continueWatching.data.length +
              hubs.data.length +
              libraries.data.length +
              mediaItems.data.length,
          )}
          detail="servers + CW + hubs + libraries + items"
        />
      </section>

      <section className="flex flex-wrap gap-2">
        <button
          type="button"
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2 text-sm disabled:opacity-50"
          disabled={!collections || continueWatching.data.length === 0}
          onClick={markFirstComplete}
        >
          Mark first CW complete (optimistic)
        </button>
        <button
          type="button"
          className="bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md px-3 py-2 text-sm disabled:opacity-50"
          disabled={
            !collections || continueWatching.data.length === 0 || isPending
          }
          onClick={warmFirstItem}
        >
          {isPending ? "Warming…" : "Warm first CW into mediaItems"}
        </button>
        <button
          type="button"
          className="border-border hover:bg-muted rounded-md border px-3 py-2 text-sm disabled:opacity-50"
          disabled={!collections}
          onClick={() => {
            const refetch = (utils: { refetch?: () => Promise<unknown> }) => {
              void utils.refetch?.();
            };
            if (!collections) return;
            refetch(collections.servers.utils);
            refetch(collections.continueWatching.utils);
            refetch(collections.homeHubs.utils);
            refetch(collections.serverLibraries.utils);
          }}
        >
          Force refetch
        </button>
      </section>

      {warmError ? (
        <p className="text-destructive text-sm" role="alert">
          {warmError}
        </p>
      ) : null}

      <DataSection
        title="Servers"
        loading={servers.isLoading}
        rows={servers.data.map((server) => ({
          key: server.id,
          primary: server.name,
          secondary: `${server.platform ?? "?"} · presence ${server.presence ? "on" : "off"} · ${server.connections.length} connections`,
        }))}
      />

      <DataSection
        title="Continue Watching"
        loading={continueWatching.isLoading}
        rows={continueWatching.data.map((item) => ({
          key: item.id,
          primary: item.grandparentTitle
            ? `${item.grandparentTitle} — ${item.title ?? item.ratingKey}`
            : (item.title ?? item.ratingKey),
          secondary: `${item.serverName ?? item.serverId} · ${item.progressPercent ?? 0}%${item.isCompleted ? " · completed" : ""}`,
        }))}
      />

      <DataSection
        title="Home hubs"
        loading={hubs.isLoading}
        rows={hubs.data.map((hub) => ({
          key: hub.id,
          primary: hub.title ?? hub.hubKey,
          secondary: `${hub.items.length} items · ${hub.serverId}`,
        }))}
      />

      <DataSection
        title="Server libraries"
        loading={libraries.isLoading}
        rows={libraries.data.map((entry) => ({
          key: entry.id,
          primary: entry.serverName,
          secondary: entry.error
            ? `error: ${entry.error}`
            : `${entry.libraries.length} libraries`,
        }))}
      />

      <DataSection
        title="Warmed media items"
        loading={mediaItems.isLoading}
        rows={mediaItems.data.map((item) => ({
          key: item.id,
          primary: item.title ?? item.ratingKey,
          secondary: `${item.type ?? "?"} · ${item.serverName ?? item.serverId}`,
        }))}
      />

      <footer className="text-muted-foreground border-border border-t pt-4 text-xs leading-relaxed">
        Reload this page while offline (DevTools → Network → Offline) after a
        successful sync. Rows should still appear from OPFS. See{" "}
        <code className="text-foreground">docs/spikes/tanstack-db-sync.md</code>{" "}
        for architecture findings vs Electric / Zero / TinyBase.
      </footer>
    </div>
  );
}

function StatusCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border-border bg-muted/30 rounded-lg border px-3 py-3">
      <p className="text-muted-foreground text-xs tracking-wide uppercase">
        {label}
      </p>
      <p className="mt-1 text-lg font-medium">{value}</p>
      <p className="text-muted-foreground mt-1 text-xs">{detail}</p>
    </div>
  );
}

function DataSection({
  title,
  loading,
  rows,
}: {
  title: string;
  loading: boolean;
  rows: Array<{ key: string; primary: string; secondary: string }>;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium">{title}</h2>
        <span className="text-muted-foreground text-xs">
          {loading ? "syncing…" : `${rows.length} rows`}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {loading ? "Waiting for local/remote data…" : "No rows yet."}
        </p>
      ) : (
        <ul className="divide-border border-border divide-y rounded-lg border">
          {rows.slice(0, 12).map((row) => (
            <li key={row.key} className="px-3 py-2">
              <p className="text-sm font-medium">{row.primary}</p>
              <p className="text-muted-foreground text-xs">{row.secondary}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
