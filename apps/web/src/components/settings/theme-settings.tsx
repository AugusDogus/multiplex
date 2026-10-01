"use client";

import { useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Plus, Upload } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { DialogClose, DialogFooter } from "~/components/ui/dialog";
import { ThemeStore, useThemePreferences } from "~/lib/themes/theme-store";
import { ThemePreferences } from "~/lib/themes/theme-preferences";
import { VsCodeTheme, type ThemeResult } from "~/lib/themes/vscode-theme";
import { ThemeSearch } from "./theme-search";
import { AppearanceModes, ThemeLibrary } from "./theme-library";

type Confirmation = { type: "remove"; theme: VsCodeTheme } | { type: "reset" };

export function ThemeSettings() {
  const { theme: mode, setTheme } = useTheme();
  const snapshot = useThemePreferences();
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const preferences =
    snapshot.status === "ready" ? snapshot.value : ThemePreferences.empty;
  const disabled = snapshot.status !== "ready" || reading;

  function choose(appearance: "light" | "dark", id: string | null) {
    setError(null);
    const result = ThemeStore.update((current) => ({
      ok: true,
      value: ThemePreferences.select(current, appearance, id),
    }));
    if (!result.ok) setError(result.error);
  }

  function install(themes: VsCodeTheme[]): ThemeResult<ThemePreferences> {
    const result = ThemeStore.update((current) => {
      const installed = ThemePreferences.install(current, themes);
      if (!installed.ok) return installed;
      let next = installed.value;
      // Select one variant per appearance, so System can use both immediately.
      for (const mode of ["light", "dark"] as const) {
        const variant = themes.find((theme) => theme.appearance === mode);
        if (variant) next = ThemePreferences.select(next, mode, variant.id);
      }
      return { ok: true, value: next };
    });
    if (result.ok) setError(null);
    return result;
  }

  async function importFiles(files: File[]) {
    if (files.length === 0) return;
    setReading(true);
    setError(null);
    try {
      if (files.length > 40) {
        setError("Import up to 40 theme files at a time.");
        return;
      }
      const themes: VsCodeTheme[] = [];
      for (const file of files) {
        if (file.size > VsCodeTheme.maxBytes) {
          setError(
            `${file.name} is larger than 1 MB. Choose a smaller theme file.`,
          );
          return;
        }
        const result = VsCodeTheme.parse(await file.text(), file.name);
        if (!result.ok) {
          setError(`${file.name}: ${result.error}`);
          return;
        }
        themes.push(result.value);
      }
      const result = install(themes);
      if (!result.ok) setError(result.error);
      else setAdding(false);
    } catch {
      setError(
        "The theme file could not be read. Select the file again. Your saved themes are unchanged.",
      );
    } finally {
      setReading(false);
    }
  }

  function confirm() {
    const result =
      confirmation?.type === "reset"
        ? ThemeStore.reset()
        : confirmation?.type === "remove"
          ? ThemeStore.update((current) => ({
              ok: true,
              value: ThemePreferences.remove(current, confirmation.theme.id),
            }))
          : null;
    if (result && !result.ok) setError(result.error);
    else {
      setError(null);
      setConfirmation(null);
    }
  }

  return (
    <section aria-labelledby="appearance-heading" className="space-y-6">
      <h1
        id="appearance-heading"
        className="text-2xl font-semibold text-balance"
      >
        Appearance
      </h1>
      <AppearanceModes
        mode={snapshot.status === "ready" ? mode : undefined}
        preferences={preferences}
        onChange={setTheme}
        disabled={disabled}
      />
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-muted-foreground text-sm font-medium text-balance">
            Themes
          </h3>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setError(null);
              setAdding(true);
            }}
          >
            <Plus className="size-3.5" />
            Add theme
          </Button>
        </div>
        <ThemeLibrary
          preferences={preferences}
          onChoose={choose}
          onRemove={(theme) => {
            setError(null);
            setConfirmation({ type: "remove", theme });
          }}
          disabled={disabled}
        />
        <p className="text-muted-foreground text-xs text-pretty">
          Choose a light and dark palette independently. System follows your
          device.
        </p>
      </div>
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
      {((error !== null && !adding) || snapshot.status === "error") && (
        <div className="space-y-2">
          <p role="alert" className="text-destructive text-sm text-pretty">
            {error ?? (snapshot.status === "error" ? snapshot.error : null)}
          </p>
          {snapshot.status === "error" && (
            <Button
              variant="outline"
              onClick={() => {
                setError(null);
                setConfirmation({ type: "reset" });
              }}
            >
              Reset saved themes
            </Button>
          )}
        </div>
      )}
      <Dialog
        open={adding}
        onOpenChange={(open) => {
          if (!reading) setAdding(open);
        }}
      >
        <DialogPopup
          bottomStickOnMobile={false}
          className="fixed top-1/2 left-1/2 max-h-[85dvh] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-[10px] p-6 sm:max-w-xl"
        >
          <DialogHeader className="p-0 text-center sm:text-left">
            <DialogTitle>Add theme</DialogTitle>
            <DialogDescription>
              Import a VS Code theme or find one on Open VSX. Themes are saved
              in this browser.
            </DialogDescription>
          </DialogHeader>
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
              disabled={disabled}
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
          <ThemeSearch
            onInstall={(themes) => {
              const result = install(themes);
              if (result.ok) setAdding(false);
              return result;
            }}
            disabled={disabled}
          />
        </DialogPopup>
      </Dialog>
      <AlertDialog.Root
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <DialogPopup
          bottomStickOnMobile={false}
          showCloseButton={false}
          className="fixed top-1/2 left-1/2 max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[10px] p-6 sm:max-w-lg"
        >
          <DialogHeader className="p-0 text-center sm:text-left">
            <DialogTitle className="text-balance">
              {confirmation?.type === "remove"
                ? `Remove ${confirmation.theme.name}?`
                : "Reset saved themes?"}
            </DialogTitle>
            <DialogDescription className="text-pretty">
              {confirmation?.type === "remove"
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
              {confirmation?.type === "remove"
                ? "Remove theme"
                : "Reset themes"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </AlertDialog.Root>
    </section>
  );
}
