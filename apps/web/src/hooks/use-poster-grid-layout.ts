"use client";

import { useLayoutEffect, useState } from "react";

import {
  estimatePosterGridTrackWidth,
  getPosterGridColumnsForWidth,
  measurePosterGridTrackWidth,
} from "~/lib/poster-grid-layout";

/** Conservative width for the pre-hydration virtualizer estimate only. */
const FALLBACK_VIEWPORT_PX = 390;

interface PosterGridLayout {
  viewportWidth: number;
  columns: number;
  /** True once the grid container ref is mounted and measured on the client. */
  isReady: boolean;
}

function readLayout(containerEl: HTMLDivElement | null): PosterGridLayout {
  const viewportWidth =
    typeof window !== "undefined" ? window.innerWidth : FALLBACK_VIEWPORT_PX;
  const trackWidth = containerEl
    ? measurePosterGridTrackWidth(containerEl)
    : estimatePosterGridTrackWidth(viewportWidth);
  return {
    viewportWidth,
    columns: getPosterGridColumnsForWidth(trackWidth, viewportWidth),
    isReady: containerEl !== null,
  };
}

/**
 * Client layout for the **virtualized** poster grid only.
 *
 * TanStack Virtual needs a JS column count (`rowCount = ceil(n / columns)`), so
 * this hook reads container track width after mount. ResizeObserver is only for
 * post-hydration updates (window resize, sidebar toggle), not for SSR.
 *
 * Static/skeleton grids use CSS `auto-fill` instead and do not need this hook.
 */
export function usePosterGridLayout(containerEl: HTMLDivElement | null) {
  const [layout, setLayout] = useState<PosterGridLayout>(() =>
    readLayout(null),
  );

  useLayoutEffect(() => {
    if (!containerEl) {
      return;
    }

    const update = () => {
      setLayout(readLayout(containerEl));
    };

    update();
    window.addEventListener("resize", update);
    const observer = new ResizeObserver(update);
    observer.observe(containerEl);
    return () => {
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, [containerEl]);

  return layout;
}
