"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "~/components/ui/dialog";
import { WatchTogetherInviteePicker } from "~/components/watch-together/watch-together-invitee-picker";
import { getWatchTogetherRoomHref } from "~/lib/watch-together-source";
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
  const createRoomMutation = api.plex.createWatchTogetherRoom.useMutation({
    onError: (error) => onFeedback(error.message),
    onSuccess: (room) => {
      handleOpenChange(false);
      onFeedback("Watch Together room created");
      router.push(getWatchTogetherRoomHref(room.id));
    },
  });

  const playable = playTarget ?? item;
  const canInvite = Boolean(playTarget && !createRoomMutation.isPending);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedUsers([]);
    }
    onOpenChange(nextOpen);
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
            Invite friends, then start a synchronized session for {item.title}.
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <WatchTogetherInviteePicker
            enabled={open}
            selectedUserIds={selectedUsers}
            onSelectedUserIdsChange={setSelectedUsers}
            disabled={createRoomMutation.isPending}
            emptyHint="No Plex friends found. You can still create a room for yourself."
          />
        </DialogPanel>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={createRoomMutation.isPending}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
