"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import { ThemeFiles } from "~/lib/themes/theme-files";
import { ThemeStore } from "~/lib/themes/theme-store";
import { ThemePreferences } from "~/lib/themes/theme-preferences";
import type { VsCodeTheme } from "~/lib/themes/vscode-theme";
import { ThemeSearch } from "./theme-search";

export function AddThemeDialog({ onClose }: { onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function install(themes: VsCodeTheme[]) {
    const result = ThemeStore.update((current) =>
      ThemePreferences.installAndSelect(current, themes),
    );
    if (result.ok) onClose();
    return result;
  }

  async function importFiles(files: File[]) {
    if (files.length === 0) return;
    setReading(true);
    setError(null);
    const parsed = await ThemeFiles.read(files);
    const result = parsed.ok ? install(parsed.value) : parsed;
    if (!result.ok) setError(result.error);
    setReading(false);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !reading) onClose();
      }}
    >
      <DialogPopup
        bottomStickOnMobile={false}
        className="fixed top-1/2 left-1/2 max-h-[85dvh] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-[10px] p-6 sm:max-w-xl"
      >
        <DialogHeader className="p-0 text-center sm:text-left">
          <DialogTitle>Add theme</DialogTitle>
          <DialogDescription>
            Import a VS Code theme or find one on Open VSX. Themes are saved in
            this browser.
          </DialogDescription>
        </DialogHeader>
        <input
          ref={input}
          type="file"
          accept=".json,.jsonc,application/json"
          multiple
          className="hidden"
          aria-label="Import VS Code theme files"
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            event.currentTarget.value = "";
            void importFiles(files);
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-dashed p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Theme files</p>
            <p className="text-muted-foreground text-xs">
              VS Code JSON or JSONC, up to 1 MB each.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={reading}
            onClick={() => input.current?.click()}
          >
            <Upload className="size-3.5" />
            {reading ? "Importing…" : "Import VS Code theme"}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm text-pretty">
            {error}
          </p>
        )}
        <ThemeSearch onInstall={install} disabled={reading} />
      </DialogPopup>
    </Dialog>
  );
}
