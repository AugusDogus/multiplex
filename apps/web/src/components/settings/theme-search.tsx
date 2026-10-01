"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { ThemePreferences } from "~/lib/themes/theme-preferences";
import { Skeleton } from "~/components/ui/skeleton";
import {
  OpenVsxThemes,
  type OpenVsxExtension,
} from "~/lib/themes/open-vsx-themes";
import type { ThemeResult, VsCodeTheme } from "~/lib/themes/vscode-theme";
import { cn } from "~/lib/utils";

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; extensions: OpenVsxExtension[] }
  | { status: "error"; error: string };

export function ThemeSearch({
  onInstall,
  disabled,
}: {
  onInstall: (themes: VsCodeTheme[]) => ThemeResult<ThemePreferences>;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [installing, setInstalling] = useState<string | null>(null);
  const [message, setMessage] = useState<ThemeResult<string> | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function search() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ status: "loading" });
    setMessage(null);
    const result = await OpenVsxThemes.search(query, controller.signal);
    if (controller.signal.aborted) return;
    setState(
      result.ok
        ? { status: "ready", extensions: result.value }
        : { status: "error", error: result.error },
    );
  }

  async function install(extension: OpenVsxExtension) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setInstalling(`${extension.namespace}/${extension.name}`);
    setMessage(null);
    const result = await OpenVsxThemes.install(extension, controller.signal);
    if (controller.signal.aborted) return;
    if (result.ok) {
      const saved = onInstall(result.value);
      setMessage(
        saved.ok
          ? {
              ok: true,
              value: `Added ${result.value.length} ${result.value.length === 1 ? "theme" : "themes"}. Choose a theme above to switch variants.`,
            }
          : saved,
      );
    } else setMessage(result);
    setInstalling(null);
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-balance">Community themes</h3>
        <p className="text-muted-foreground text-sm text-pretty">
          Find VS Code color themes on{" "}
          <a
            className="underline underline-offset-4"
            href="https://open-vsx.org"
            target="_blank"
            rel="noreferrer"
          >
            Open VSX
          </a>
          .
        </p>
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <div className="min-w-0 flex-1 space-y-2">
          <label className="text-sm font-medium" htmlFor="theme-search">
            Search themes
          </label>
          <Input
            id="theme-search"
            type="search"
            placeholder="Dracula, Nord, Catppuccin…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={200}
            disabled={disabled || installing !== null}
          />
        </div>
        <Button
          variant="outline"
          disabled={
            disabled ||
            !query.trim() ||
            state.status === "loading" ||
            installing !== null
          }
        >
          Search
        </Button>
      </form>
      {state.status === "loading" && (
        <div role="status" className="space-y-2">
          <span className="sr-only">Searching community themes…</span>
          <Skeleton className="h-20 motion-reduce:animate-none" />
          <Skeleton className="h-20 motion-reduce:animate-none" />
        </div>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-sm text-pretty">
          {state.error}
        </p>
      )}
      {state.status === "ready" &&
        (state.extensions.length === 0 ? (
          <p
            role="status"
            className="text-muted-foreground text-sm text-pretty"
          >
            No themes found. Try a different search.
          </p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {state.extensions.map((extension) => {
              const id = `${extension.namespace}/${extension.name}`;
              const name = extension.displayName ?? extension.name;
              return (
                <li
                  key={id}
                  className="flex items-center gap-3 rounded-[10px] border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{name}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {extension.namespace}
                    </p>
                    {extension.description && (
                      <p className="text-muted-foreground mt-1 line-clamp-2 text-xs text-pretty">
                        {extension.description}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Add ${name}`}
                    disabled={disabled || installing !== null}
                    onClick={() => void install(extension)}
                  >
                    {installing === id ? "Adding…" : "Add"}
                  </Button>
                </li>
              );
            })}
          </ul>
        ))}
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={cn(
            "text-sm text-pretty",
            message.ok ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {message.ok ? message.value : message.error}
        </p>
      )}
    </div>
  );
}
