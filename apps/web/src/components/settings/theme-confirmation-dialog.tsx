"use client";
import { useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "~/components/ui/dialog";
import { ThemeStore } from "~/lib/themes/theme-store";
import { ThemePreferences } from "~/lib/themes/theme-preferences";
import type { VsCodeTheme } from "~/lib/themes/vscode-theme";
export type ThemeConfirmation =
  | { type: "remove"; theme: VsCodeTheme }
  | { type: "reset" };
export function ThemeConfirmationDialog({
  confirmation,
  onClose,
}: {
  confirmation: ThemeConfirmation;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  function confirm() {
    const result =
      confirmation.type === "reset"
        ? ThemeStore.reset()
        : ThemeStore.update((current) => ({
            ok: true,
            value: ThemePreferences.remove(current, confirmation.theme.id),
          }));
    if (!result.ok) setError(result.error);
    else {
      setError(null);
      onClose();
    }
  }

  return (
    <AlertDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup
        bottomStickOnMobile={false}
        showCloseButton={false}
        className="fixed top-1/2 left-1/2 max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[10px] p-6 sm:max-w-lg"
      >
        <DialogHeader className="p-0 text-center sm:text-left">
          <DialogTitle className="text-balance">
            {confirmation.type === "remove"
              ? `Remove ${confirmation.theme.name}?`
              : "Reset saved themes?"}
          </DialogTitle>
          <DialogDescription className="text-pretty">
            {confirmation.type === "remove"
              ? "Multiplex will use its default palette instead. You can import this theme again later. Your files are unchanged."
              : "This removes all imported themes from this browser and restores Multiplex’s default palettes. Your files are unchanged."}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-destructive text-sm text-pretty">
            {error}
          </p>
        )}
        <DialogFooter variant="bare" className="p-0 pt-0">
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            onClick={(event) => {
              event.preventDefault();
              confirm();
            }}
          >
            {confirmation.type === "remove" ? "Remove theme" : "Reset themes"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </AlertDialog.Root>
  );
}
