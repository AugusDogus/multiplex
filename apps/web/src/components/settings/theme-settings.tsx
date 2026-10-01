"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { ThemeStore, useThemePreferences } from "~/lib/themes/theme-store";
import { ThemePreferences } from "~/lib/themes/theme-preferences";
import { AppearanceModes, ThemeLibrary } from "./theme-library";
import { AddThemeDialog } from "./add-theme-dialog";
import {
  ThemeConfirmationDialog,
  type ThemeConfirmation,
} from "./theme-confirmation-dialog";

type AppearanceDialog = { type: "add" } | ThemeConfirmation;

export function ThemeSettings() {
  const { theme: mode, setTheme } = useTheme();
  const snapshot = useThemePreferences();
  const [dialog, setDialog] = useState<AppearanceDialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preferences =
    snapshot.status === "ready" ? snapshot.value : ThemePreferences.empty;
  const disabled = snapshot.status !== "ready";

  function choose(appearance: "light" | "dark", id: string | null) {
    const result = ThemeStore.update((current) => ({
      ok: true,
      value: ThemePreferences.select(current, appearance, id),
    }));
    setError(result.ok ? null : result.error);
  }

  function openDialog(next: AppearanceDialog) {
    setError(null);
    setDialog(next);
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
        mode={disabled ? undefined : mode}
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
            onClick={() => openDialog({ type: "add" })}
          >
            <Plus className="size-3.5" />
            Add theme
          </Button>
        </div>
        <ThemeLibrary
          preferences={preferences}
          onChoose={choose}
          onRemove={(theme) => openDialog({ type: "remove", theme })}
          disabled={disabled}
        />
        <p className="text-muted-foreground text-xs text-pretty">
          Choose a light and dark palette independently. System follows your
          device.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm text-pretty">
          {error}
        </p>
      )}
      {snapshot.status === "error" && (
        <div className="space-y-2">
          <p role="alert" className="text-destructive text-sm text-pretty">
            {snapshot.error}
          </p>
          <Button
            variant="outline"
            onClick={() => openDialog({ type: "reset" })}
          >
            Reset saved themes
          </Button>
        </div>
      )}
      <AppearanceDialogContent
        dialog={dialog}
        onClose={() => setDialog(null)}
      />
    </section>
  );
}

function AppearanceDialogContent({
  dialog,
  onClose,
}: {
  dialog: AppearanceDialog | null;
  onClose: () => void;
}) {
  if (!dialog) return null;
  if (dialog.type === "add") return <AddThemeDialog onClose={onClose} />;
  return <ThemeConfirmationDialog confirmation={dialog} onClose={onClose} />;
}
