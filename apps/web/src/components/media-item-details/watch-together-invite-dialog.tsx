"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Link2, Loader2, ShieldAlert, Users } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { WatchTogetherInviteePicker } from "~/components/watch-together/watch-together-invitee-picker";
import { refetchSyncedWatchTogetherRooms } from "~/lib/sync-engine";
import {
  getWatchTogetherRoomHref,
  storeGuestHostCapability,
} from "~/lib/watch-together-source";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/api";

import type { ItemDetails, PlayTarget } from "./types";

interface WatchTogetherInviteDialogProps {
  item: ItemDetails["item"];
  playTarget: PlayTarget;
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFeedback: (message: string) => void;
}

type InviteMode = "plex-friends" | "guest-link";

const PLEX_HOME_SETTINGS_URL =
  "https://app.plex.tv/desktop/#!/settings/plex-home";

export function WatchTogetherInviteDialog({
  item,
  playTarget,
  serverId,
  open,
  onOpenChange,
  onFeedback,
}: WatchTogetherInviteDialogProps) {
  const router = useRouter();
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [mode, setMode] = useState<InviteMode>("plex-friends");
  const [confirmGuestEnable, setConfirmGuestEnable] = useState(false);
  const playable = playTarget ?? item;

  const eligibilityQuery = api.guestWatchTogether.eligibility.useQuery(
    {
      serverId,
      ratingKey: playable.ratingKey,
    },
    {
      enabled: open && Boolean(playTarget),
      retry: false,
      staleTime: 30_000,
    },
  );
  const createRoomMutation = api.plex.createWatchTogetherRoom.useMutation({
    onError: (error) => onFeedback(error.message),
    onSuccess: async (room) => {
      await refetchSyncedWatchTogetherRooms();
      handleOpenChange(false);
      onFeedback("Watch Together room created");
      router.push(getWatchTogetherRoomHref(room.id));
    },
  });
  const createGuestLinkMutation = api.guestWatchTogether.createLink.useMutation(
    {
      onError: (error) => onFeedback(error.message),
      onSuccess: (result) => {
        handleOpenChange(false);
        onFeedback("Trusted Guest link created");
        storeGuestHostCapability(result.room.id, result.capability);
        router.push(result.hostRoomPath);
      },
    },
  );
  const enableGuestMutation = api.guestWatchTogether.enableGuest.useMutation({
    onError: (error) => onFeedback(error.message),
    onSuccess: async (result) => {
      if (result.status === "ready") {
        onFeedback("Plex Home Guest enabled");
        setConfirmGuestEnable(false);
        await eligibilityQuery.refetch();
        return;
      }
      onFeedback("Plex could not enable the Guest profile");
    },
  });

  const pending =
    createRoomMutation.isPending ||
    createGuestLinkMutation.isPending ||
    enableGuestMutation.isPending;
  const canInvite = Boolean(playTarget && !pending);
  const guestReady = eligibilityQuery.data?.status === "ready";

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedUsers([]);
      setMode("plex-friends");
      setConfirmGuestEnable(false);
    }
    onOpenChange(nextOpen);
  };

  const createGuestLink = () => {
    if (!playTarget || pending || !guestReady) {
      return;
    }
    createGuestLinkMutation.mutate({
      serverId,
      ratingKey: playable.ratingKey,
      key: playable.key,
      title: playable.title,
    });
  };

  const createRoom = () => {
    if (!playTarget || createRoomMutation.isPending) {
      return;
    }

    createRoomMutation.mutate({
      serverId,
      ratingKey: playable.ratingKey,
      key: playable.key,
      title: playable.title,
      users: selectedUsers,
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Watch Together</DialogTitle>
          <DialogDescription className="line-clamp-2">
            Choose who can join the synchronized session for {item.title}.
          </DialogDescription>
        </DialogHeader>

        <div
          className="grid grid-cols-2 gap-2"
          role="group"
          aria-label="Invite type"
        >
          <InviteModeButton
            active={mode === "plex-friends"}
            disabled={pending}
            icon={Users}
            title="Plex friends"
            description="Invite known accounts"
            onClick={() => setMode("plex-friends")}
          />
          <InviteModeButton
            active={mode === "guest-link"}
            disabled={pending}
            icon={Link2}
            title="Guest link"
            description="No Plex account needed"
            onClick={() => setMode("guest-link")}
          />
        </div>

        {mode === "plex-friends" ? (
          <WatchTogetherInviteePicker
            enabled={open}
            selectedUserIds={selectedUsers}
            onSelectedUserIdsChange={setSelectedUsers}
            disabled={pending}
            emptyHint="No Plex friends found. You can still create a room for yourself."
          />
        ) : (
          <GuestLinkSetup
            eligibility={eligibilityQuery.data}
            checking={eligibilityQuery.isPending || eligibilityQuery.isFetching}
            enabling={enableGuestMutation.isPending}
            confirmEnable={confirmGuestEnable}
            onReviewEnable={() => setConfirmGuestEnable(true)}
            onCancelEnable={() => setConfirmGuestEnable(false)}
            onEnable={() => enableGuestMutation.mutate()}
            onRetry={() => eligibilityQuery.refetch()}
          />
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          {mode === "plex-friends" ? (
            <Button
              type="button"
              disabled={!canInvite}
              onClick={createRoom}
              className="min-w-32"
            >
              {createRoomMutation.isPending && (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              )}
              {selectedUsers.length > 0
                ? `Invite ${selectedUsers.length}`
                : "Create room"}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={!canInvite || !guestReady}
              onClick={createGuestLink}
              className="min-w-32"
            >
              {createGuestLinkMutation.isPending && (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              )}
              Create guest link
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteModeButton({
  active,
  disabled,
  icon: Icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  icon: typeof Users;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "focus-visible:ring-ring flex min-h-20 flex-col items-start rounded-xl border p-3 text-left transition-[border-color,background-color,transform] duration-150 ease-out outline-none focus-visible:ring-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        active ? "border-primary bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4" />
        {title}
      </span>
      <span className="text-muted-foreground mt-1 text-xs">{description}</span>
    </button>
  );
}

type Eligibility =
  | {
      status: "ready";
      guest: { id: number; title: string };
    }
  | {
      status: "unavailable";
      reason:
        | "guest-disabled"
        | "guest-protected"
        | "not-home-member"
        | "guest-switch-failed"
        | "server-unavailable"
        | "item-unavailable"
        | "plex-unavailable";
      canEnableGuest: boolean;
    };

type EligibilityReason = Extract<
  Eligibility,
  { status: "unavailable" }
>["reason"];

function GuestLinkSetup({
  eligibility,
  checking,
  enabling,
  confirmEnable,
  onReviewEnable,
  onCancelEnable,
  onEnable,
  onRetry,
}: {
  eligibility: Eligibility | undefined;
  checking: boolean;
  enabling: boolean;
  confirmEnable: boolean;
  onReviewEnable: () => void;
  onCancelEnable: () => void;
  onEnable: () => void;
  onRetry: () => void;
}) {
  if (checking && !eligibility) {
    return (
      <div className="text-muted-foreground flex min-h-32 items-center justify-center gap-2 rounded-xl border p-4 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Checking Plex Guest access…
      </div>
    );
  }

  if (eligibility?.status === "ready") {
    return (
      <div className="bg-muted/40 rounded-xl border p-4">
        <div className="flex gap-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-500" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Trusted Guest link</p>
            <p className="text-muted-foreground text-sm">
              Anyone with the link temporarily receives the Plex Home Guest
              profile&apos;s library access. The host starts playback manually.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (eligibility?.reason === "guest-disabled" && eligibility.canEnableGuest) {
    if (confirmEnable) {
      return (
        <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-medium">Enable Plex Home Guest?</p>
              <p className="text-muted-foreground mt-1 text-sm">
                If this creates a Plex Home, Plex will require authenticated
                server access and disable DLNA by default. You will still choose
                Guest library access in Plex.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancelEnable}
            >
              Back
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={enabling}
              onClick={onEnable}
            >
              {enabling && (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              )}
              Enable Guest
            </Button>
          </div>
        </div>
      );
    }
    return (
      <SetupMessage
        title="Plex Home Guest is off"
        description="Enable the built-in Guest profile before creating a shareable link."
        action="Review and enable"
        onAction={onReviewEnable}
      />
    );
  }

  const content = getGuestSetupCopy(eligibility?.reason);
  return (
    <SetupMessage
      title={content.title}
      description={content.description}
      action={content.retry ? "Check again" : "Open Plex Home settings"}
      onAction={content.retry ? onRetry : undefined}
      href={content.retry ? undefined : PLEX_HOME_SETTINGS_URL}
    />
  );
}

function SetupMessage({
  title,
  description,
  action,
  onAction,
  href,
}: {
  title: string;
  description: string;
  action: string;
  onAction?: () => void;
  href?: string;
}) {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
      {href ? (
        <Button asChild type="button" variant="outline" size="sm">
          <a href={href} target="_blank" rel="noreferrer">
            {action}
            <ExternalLink data-icon="inline-end" />
          </a>
        </Button>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}

function getGuestSetupCopy(reason: EligibilityReason | undefined) {
  switch (reason) {
    case "guest-protected":
      return {
        title: "Guest is PIN-protected",
        description: "Remove the Guest PIN in Plex before creating a link.",
        retry: false,
      };
    case "not-home-member":
      return {
        title: "Plex Home access required",
        description:
          "Only an eligible member of this Plex Home can use its Guest profile.",
        retry: false,
      };
    case "server-unavailable":
      return {
        title: "Guest cannot access this server",
        description:
          "Give the Guest profile access to this server and its libraries in Plex.",
        retry: false,
      };
    case "item-unavailable":
      return {
        title: "Guest cannot access this title",
        description:
          "Adjust the Guest profile's library or content restrictions in Plex.",
        retry: false,
      };
    case "guest-switch-failed":
    case "plex-unavailable":
    case "guest-disabled":
    case undefined:
      return {
        title: "Guest access could not be verified",
        description: "Check Plex and try again.",
        retry: true,
      };
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}
