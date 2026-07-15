"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "~/components/ui/button";
import { api } from "~/trpc/api";

export type LiveTvGuideRefreshState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "error"; message: string };

type LiveTvGuideRefreshResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export async function requestLiveTvGuideRefresh(
  requestReload: () => Promise<{ message: string }>,
): Promise<LiveTvGuideRefreshResult> {
  try {
    const result = await requestReload();
    return { ok: true, message: result.message };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "The guide refresh could not be requested.",
    };
  }
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
  const [state, setState] = useState<LiveTvGuideRefreshState>({
    status: "idle",
  });
  const requestInFlight = useRef(false);

  const requestRefresh = async () => {
    if (requestInFlight.current) return;

    requestInFlight.current = true;
    setState({ status: "requesting" });
    const result = await requestLiveTvGuideRefresh(() =>
      reloadGuide.mutateAsync({ machineIdentifier, providerIdentifier }),
    );

    if (!result.ok) {
      setState({ status: "error", message: result.message });
      requestInFlight.current = false;
      return;
    }

    requestInFlight.current = false;
    setState({ status: "idle" });
    router.refresh();
  };

  const isPending = state.status === "requesting";
  const description =
    state.status === "error"
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
        onClick={() => void requestRefresh()}
      >
        {isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        {state.status === "requesting" ? "Requesting…" : "Refresh guide"}
      </Button>
    </div>
  );
}
