"use client";

import { Loader2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

interface PlaylistDeleteDialogProps {
  open: boolean;
  title: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function PlaylistDeleteDialog({
  open,
  title,
  pending,
  onOpenChange,
  onConfirm,
}: PlaylistDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{title}”?</DialogTitle>
          <DialogDescription>
            This permanently deletes the entire playlist. Your media files are
            not deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending && <Loader2 className="animate-spin" />}
            Delete playlist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
