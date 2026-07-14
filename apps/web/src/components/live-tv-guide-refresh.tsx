"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "~/components/ui/button";
import { api } from "~/trpc/api";

export const GUIDE_REFRESH_DELAY_MS = 1_500;

export type LiveTvGuideRefreshState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "scheduled"; message: string }
  | { status: "error"; message: string };

interface LiveTvGuideRefreshControllerOptions {
  requestReload: () => Promise<{ message: string }>;
  refresh: () => void;
  schedule: (callback: () => void, delayMs: number) => number;
  cancel: (timer: number) => void;
}

export function createLiveTvGuideRefreshController({
  requestReload,
  refresh,
  schedule,
  cancel,
}: LiveTvGuideRefreshControllerOptions) {
  let state: LiveTvGuideRefreshState = { status: "idle" };
  let timer: number | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();

  const publish = (next: LiveTvGuideRefreshState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const getSnapshot = () => state;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const request = async (): Promise<void> => {
    if (
      disposed ||
      state.status === "requesting" ||
      state.status === "scheduled"
    ) {
      return;
    }

    publish({ status: "requesting" });

    try {
      const result = await requestReload();
      if (disposed) return;

      publish({ status: "scheduled", message: result.message });
      timer = schedule(() => {
        timer = null;
        if (disposed) return;
        refresh();
        publish({ status: "idle" });
      }, GUIDE_REFRESH_DELAY_MS);
    } catch (error) {
      if (disposed) return;
      publish({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "The guide refresh could not be requested.",
      });
    }
  };
  const dispose = () => {
    disposed = true;
    if (timer !== null) cancel(timer);
    timer = null;
    listeners.clear();
  };

  return {
    getSnapshot,
    subscribe,
    request,
    dispose,
  };
}

interface LiveTvGuideRefreshProps {
  machineIdentifier: string;
  providerIdentifier: string;
}

export function LiveTvGuideRefresh({
  machineIdentifier,
  providerIdentifier,
}: LiveTvGuideRefreshProps) {
  const router = useRouter();
  const reloadGuide = api.plex.reloadServerGuide.useMutation();
  const [controller] = useState(() =>
    createLiveTvGuideRefreshController({
      requestReload: () =>
        reloadGuide.mutateAsync({ machineIdentifier, providerIdentifier }),
      refresh: () => router.refresh(),
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (timer) => window.clearTimeout(timer),
    }),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => () => controller.dispose(), [controller]);

  const isPending =
    state.status === "requesting" || state.status === "scheduled";
  const description =
    state.status === "scheduled"
      ? `${state.message} Checking again shortly…`
      : state.status === "error"
        ? state.message
        : "No guide programming is available yet. You can ask Plex to refresh it.";

  return (
    <div className="border-border bg-muted/30 mx-4 mb-4 flex flex-col gap-3 rounded-lg border p-4 sm:mx-6 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">Guide data unavailable</p>
        <p
          className={
            state.status === "error"
              ? "text-destructive text-sm"
              : "text-muted-foreground text-sm"
          }
          role="status"
        >
          {description}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={isPending}
        onClick={() => void controller.request()}
      >
        {isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        {state.status === "requesting"
          ? "Requesting…"
          : state.status === "scheduled"
            ? "Refresh requested"
            : "Refresh guide"}
      </Button>
    </div>
  );
}
