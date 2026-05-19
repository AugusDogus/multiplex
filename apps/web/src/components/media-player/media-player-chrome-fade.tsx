"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "~/lib/utils";

type ChromeFadeState = "hidden" | "visible" | "hiding";

interface MediaPlayerChromeFadeProps {
  visible: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Fades media player chrome in/out using CSS keyframe animations.
 * Animations are restarted via forced reflow when state changes so each
 * show/hide actually runs (toggling classes alone is not enough).
 */
export function MediaPlayerChromeFade({
  visible,
  children,
  className,
}: MediaPlayerChromeFadeProps) {
  const [state, setState] = useState<ChromeFadeState>(() =>
    visible ? "visible" : "hidden",
  );
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible) {
      setState("visible");
      return;
    }
    setState((current) => (current === "hidden" ? "hidden" : "hiding"));
  }, [visible]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer || state === "hidden") return;

    // Force the stylesheet animation for this data-state to run from scratch.
    layer.style.animation = "none";
    void layer.offsetHeight;
    layer.style.removeProperty("animation");
  }, [state]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || state !== "hiding") return;

    const onAnimationEnd = (event: AnimationEvent) => {
      if (event.target !== layer) return;
      setState("hidden");
    };

    layer.addEventListener("animationend", onAnimationEnd);
    return () => layer.removeEventListener("animationend", onAnimationEnd);
  }, [state]);

  return (
    <div
      ref={layerRef}
      data-state={state}
      aria-hidden={state !== "visible"}
      className={cn("mp-chrome-layer", className)}
    >
      {children}
    </div>
  );
}
