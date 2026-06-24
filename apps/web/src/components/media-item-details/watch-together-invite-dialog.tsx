"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Users } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { getWatchTogetherDeviceIdentifier } from "~/lib/device-identifier";
import { getWatchTogetherRoomHref } from "~/lib/watch-together-source";
import { cn } from "~/lib/utils";
import { useWatchTogetherStore } from "~/stores/watch-together-store";
import { api } from "~/trpc/react";

import type { ItemDetails, PlayTarget } from "./types";

interface WatchTogetherInviteDialogProps {
  item: ItemDetails["item"];
  playTarget: PlayTarget;
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFeedback: (message: string) => void;
}

export function WatchTogetherInviteDialog({
  item,
  playTarget,
  serverId,
  open,
  onOpenChange,
  onFeedback,
}: WatchTogetherInviteDialogProps) {
  const router = useRouter();
  const setSession = useWatchTogetherStore((state) => state.setSession);
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const inviteesQuery = api.plex.getWatchTogetherInvitees.useQuery(undefined, {
    enabled: open,
    staleTime: 60_000,
  });
  const userInfoQuery = api.plex.getUserInfo.useQuery(undefined, {
    enabled: open,
    staleTime: 60_000,
  });
  const createRoomMutation = api.plex.createWatchTogetherRoom.useMutation({
    onError: (error) => onFeedback(error.message),
    onSuccess: (room) => {
      const localUser = userInfoQuery.data;
      if (localUser) {
        setSession({
          room,
          localUser: {
            id: localUser.id,
            deviceIdentifier: getWatchTogetherDeviceIdentifier(),
            deviceName: "Multiplex Web",
          },
        });
      }

      onOpenChange(false);
      onFeedback("Watch Together room created");
      router.push(getWatchTogetherRoomHref(room.id));
    },
  });

  const invitees = inviteesQuery.data ?? [];
  const isBusy =
    createRoomMutation.isPending ||
    inviteesQuery.isPending ||
    userInfoQuery.isPending;
  const playable = playTarget ?? item;
  const canInvite = Boolean(playTarget && userInfoQuery.data && !isBusy);

  const selectedSet = useMemo(() => new Set(selectedUsers), [selectedUsers]);

  const toggleInvitee = (id: number) => {
    setSelectedUsers((current) =>
      current.includes(id)
        ? current.filter((currentId) => currentId !== id)
        : [...current, id],
    );
  };

  const createRoom = () => {
    if (!playTarget || !userInfoQuery.data || createRoomMutation.isPending) {
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Watch Together</DialogTitle>
          <DialogDescription className="line-clamp-2">
            Invite friends, then start a synchronized session for {item.title}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            Friends and Accounts with Library Access
          </p>
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {inviteesQuery.isPending ? (
              <InviteStatus>
                <Loader2 className="size-4 animate-spin" /> Loading friends...
              </InviteStatus>
            ) : inviteesQuery.isError ? (
              <InviteStatus>Could not load invitees.</InviteStatus>
            ) : invitees.length === 0 ? (
              <InviteStatus>
                No Plex friends found. You can still create a room for yourself.
              </InviteStatus>
            ) : (
              invitees.map((invitee) => {
                const selected = selectedSet.has(invitee.id);
                return (
                  <button
                    key={invitee.id}
                    type="button"
                    className={cn(
                      "hover:bg-accent focus-visible:bg-accent flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors outline-none",
                      selected && "bg-accent",
                    )}
                    disabled={createRoomMutation.isPending}
                    onClick={() => toggleInvitee(invitee.id)}
                  >
                    <span className="bg-muted flex size-9 items-center justify-center rounded-full">
                      <Users className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 font-medium">
                        {invitee.title || invitee.username}
                      </span>
                      <span className="text-muted-foreground line-clamp-1 text-xs">
                        {invitee.username}
                      </span>
                    </span>
                    {selected && (
                      <span className="text-primary text-xs font-medium">
                        Selected
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={createRoomMutation.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={!canInvite} onClick={createRoom}>
            {createRoomMutation.isPending && (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            )}
            Invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteStatus({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 px-3 py-6 text-sm">
      {children}
    </div>
  );
}
