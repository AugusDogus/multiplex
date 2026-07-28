"use client";

import { Check, Gamepad2, Link2 } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";

import { Button } from "~/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";

const linkResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("linked"),
    device: z.object({
      id: z.string(),
      name: z.string(),
      platform: z.enum(["gamecube", "wii", "dreamcast", "xbox", "ps2"]),
    }),
  }),
  z.object({ status: z.literal("invalid-code") }),
  z.object({ status: z.literal("rate-limited") }),
  z.object({ status: z.literal("invalid-request") }),
  z.object({ status: z.literal("unauthorized") }),
]);

type LinkState =
  | { status: "ready" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | { status: "linked"; deviceName: string };

export function ConsoleLinkForm() {
  const [code, setCode] = useState("");
  const [state, setState] = useState<LinkState>({ status: "ready" });
  const inputRef = useRef<HTMLInputElement>(null);
  const isSubmitting = state.status === "submitting";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.length !== 4 || isSubmitting) return;

    setState({ status: "submitting" });
    try {
      const response = await fetch("/api/console/pairings/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const parsed = linkResponseSchema.safeParse(await response.json());
      if (response.ok && parsed.success && parsed.data.status === "linked") {
        setState({
          status: "linked",
          deviceName: parsed.data.device.name,
        });
        return;
      }

      setState({
        status: "error",
        message:
          response.status === 401
            ? "Your session expired. Refresh this page and sign in again."
            : response.status === 429
              ? "Too many attempts. Wait a few minutes, then use a new code from the console."
              : "That code is invalid or has expired. Check the console and try again.",
      });
      requestAnimationFrame(() => inputRef.current?.select());
    } catch {
      setState({
        status: "error",
        message: "Multiplex could not link the console. Try again in a moment.",
      });
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }

  if (state.status === "linked") {
    return (
      <Card className="w-full max-w-md">
        <CardPanel className="flex flex-col items-center gap-5 py-10 text-center">
          <div className="bg-success/12 text-success-foreground flex size-12 items-center justify-center rounded-full">
            <Check className="size-6" strokeWidth={2.25} />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight">
              Console linked
            </h1>
            <p className="text-muted-foreground max-w-xs text-sm leading-6">
              {state.deviceName} can now use your Multiplex account. You can
              return to the console.
            </p>
          </div>
        </CardPanel>
      </Card>
    );
  }

  const errorMessage = state.status === "error" ? state.message : null;

  return (
    <div className="relative w-full max-w-md">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <div className="border-border bg-card flex size-10 items-center justify-center rounded-xl border shadow-xs">
          <Gamepad2 className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Link a console
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Enter the code shown by Multiplex on your console.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="text-muted-foreground size-4" />
            Pairing code
          </CardTitle>
          <CardDescription>
            Codes contain four letters or numbers and expire after five minutes.
          </CardDescription>
        </CardHeader>
        <CardPanel>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <label className="sr-only" htmlFor="console-link-code">
                Four-character console pairing code
              </label>
              <Input
                ref={inputRef}
                id="console-link-code"
                nativeInput
                autoCapitalize="characters"
                autoComplete="one-time-code"
                autoCorrect="off"
                autoFocus
                className="rounded-xl"
                inputMode="text"
                maxLength={4}
                onChange={(event) => {
                  setCode(
                    event.target.value
                      .toUpperCase()
                      .replaceAll(/[^A-Z0-9]/g, "")
                      .slice(0, 4),
                  );
                  if (state.status === "error") {
                    setState({ status: "ready" });
                  }
                }}
                placeholder="ABCD"
                size="lg"
                spellCheck={false}
                value={code}
                aria-describedby={
                  errorMessage ? "console-link-error" : undefined
                }
                aria-invalid={errorMessage ? true : undefined}
              />
              {errorMessage ? (
                <p
                  id="console-link-error"
                  className="text-destructive-foreground text-sm leading-5"
                  role="alert"
                >
                  {errorMessage}
                </p>
              ) : null}
            </div>
            <Button
              className="w-full active:scale-[0.98] motion-reduce:transform-none"
              disabled={code.length !== 4}
              loading={isSubmitting}
              size="lg"
              type="submit"
            >
              Link console
            </Button>
          </form>
        </CardPanel>
      </Card>

      <p className="text-muted-foreground mt-5 text-center text-xs leading-5">
        Linking grants this console access to Multiplex. Your Plex password and
        account token are never sent to it.
      </p>
    </div>
  );
}
