"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAtomSet } from "@effect/atom-react";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

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
import { createWatchTogetherRoom } from "~/lib/effect/plex-atoms";
import { watchTogetherRoomWriteKeys } from "~/lib/effect/reactivity-keys";
import { getWatchTogetherRoomHref } from "~/lib/watch-together-source";

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
  const [isPending, setIsPending] = useState(false);
  const createRoomMutation = useAtomSet(createWatchTogetherRoom, {
    mode: "promiseExit",
  });

  const playable = playTarget ?? item;
  const canInvite = Boolean(playTarget && !isPending);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedUsers([]);
    }
    onOpenChange(nextOpen);
  };

  const createRoom = async () => {
    if (!playTarget || isPending) {
      return;
    }

    setIsPending(true);
    const exit = await createRoomMutation({
      payload: {
        serverId,
        ratingKey: playable.ratingKey,
        key: playable.key,
        title: playable.title,
        users: selectedUsers,
      },
      reactivityKeys: watchTogetherRoomWriteKeys,
    });
    if (Exit.isFailure(exit)) {
      const error = Exit.findErrorOption(exit);
      onFeedback(
        Option.isSome(error) &&
          error.value !== null &&
          typeof error.value === "object" &&
          "message" in error.value &&
          typeof (error.value as { message: unknown }).message === "string"
          ? (error.value as { message: string }).message
          : "Failed to create Watch Together room",
      );
      setIsPending(false);
      return;
    }
    handleOpenChange(false);
    onFeedback("Watch Together room created");
    router.push(getWatchTogetherRoomHref(exit.value.id));
    setIsPending(false);
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

        <WatchTogetherInviteePicker
          enabled={open}
          selectedUserIds={selectedUsers}
          onSelectedUserIdsChange={setSelectedUsers}
          disabled={isPending}
          emptyHint="No Plex friends found. You can still create a room for yourself."
        />

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canInvite}
            onClick={() => {
              void createRoom();
            }}
            className="min-w-32"
          >
            {isPending && (
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
