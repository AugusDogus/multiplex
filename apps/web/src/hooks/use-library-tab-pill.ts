"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type RefObject,
  type TransitionEvent,
} from "react";
import { flushSync } from "react-dom";

export interface PillMetrics {
  x: number;
  y: number;
  width: number;
  height: number;
  ready: boolean;
}

type PillMemory = PillMetrics & { pivot: string };

const EMPTY_PILL: PillMetrics = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  ready: false,
};

/**
 * Soft-nav can remount the tabs client tree when the pivot search param
 * changes. Remember pill geometry per library so a remount can continue from
 * the in-flight visual position instead of jumping.
 */
const pillMemory = new Map<string, PillMemory>();

function memoryKey(pathname: string, source: string | null): string {
  return `${pathname}?source=${source ?? ""}`;
}

export function pillStyle(metrics: PillMetrics): CSSProperties {
  return {
    width: metrics.width,
    height: metrics.height,
    transform: `translate3d(${metrics.x}px, ${metrics.y}px, 0)`,
  };
}

function readTabMetrics(tab: HTMLElement): PillMetrics {
  return {
    x: tab.offsetLeft,
    y: tab.offsetTop,
    width: tab.offsetWidth,
    height: tab.offsetHeight,
    ready: true,
  };
}

/** Where the pill is on screen right now — including mid-transition. */
function readPillVisualMetrics(pill: HTMLElement): PillMetrics | null {
  const style = getComputedStyle(pill);
  if (style.transform === "none") {
    return null;
  }

  const matrix = new DOMMatrixReadOnly(style.transform);
  const width = Number.parseFloat(style.width);
  const height = Number.parseFloat(style.height);
  if (
    !Number.isFinite(matrix.m41) ||
    !Number.isFinite(matrix.m42) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return {
    x: matrix.m41,
    y: matrix.m42,
    width,
    height,
    ready: true,
  };
}

interface UseLibraryTabPillArgs {
  pathname: string;
  source: string | null;
  urlPivot: string;
  activePivot: string;
  tabIds: string;
  scrollRef: RefObject<HTMLElement | null>;
  pillRef: RefObject<HTMLSpanElement | null>;
  tabRefs: MutableRefObject<Map<string, HTMLAnchorElement>>;
  clickDrivenRef: MutableRefObject<boolean>;
}

interface UseLibraryTabPillResult {
  pill: PillMetrics;
  motionEnabled: boolean;
  movePillToTab: (pivotId: string, options?: { snap?: boolean }) => void;
  onPillTransitionEnd: (event: TransitionEvent<HTMLSpanElement>) => void;
}

export function useLibraryTabPill({
  pathname,
  source,
  urlPivot,
  activePivot,
  tabIds,
  scrollRef,
  pillRef,
  tabRefs,
  clickDrivenRef,
}: UseLibraryTabPillArgs): UseLibraryTabPillResult {
  const key = memoryKey(pathname, source);
  const slidingRef = useRef(false);
  const moveRafRef = useRef(0);
  const enableMotionRafRef = useRef(0);

  const remembered = pillMemory.get(key);
  // Deep links / first paint: no memory → snap with motion off.
  // Soft-nav remount mid-slide: memory for a different pivot → keep sliding.
  const restoreForSlide = Boolean(
    remembered?.ready && remembered.pivot !== urlPivot,
  );
  const restoreOnTarget = Boolean(
    remembered?.ready && remembered.pivot === urlPivot,
  );

  const [pill, setPill] = useState<PillMetrics>(() =>
    remembered?.ready ? remembered : EMPTY_PILL,
  );
  // Only enable CSS transitions after the first correct paint (or when
  // continuing an in-flight slide across a remount).
  const [motionEnabled, setMotionEnabled] = useState(restoreForSlide);
  const hasMeasuredRef = useRef(restoreForSlide || restoreOnTarget);
  const restoreForSlideRef = useRef(restoreForSlide);
  const restoreOnTargetRef = useRef(restoreOnTarget);

  const persistPill = (metrics: PillMetrics, pivotId: string) => {
    setPill(metrics);
    pillMemory.set(key, { ...metrics, pivot: pivotId });
  };

  const enableMotionAfterPaint = () => {
    cancelAnimationFrame(enableMotionRafRef.current);
    enableMotionRafRef.current = requestAnimationFrame(() => {
      enableMotionRafRef.current = requestAnimationFrame(() => {
        setMotionEnabled(true);
      });
    });
  };

  /**
   * Retarget the pill from its live visual position to a tab. Capturing the
   * computed transform (not the destination tab box) keeps mid-flight clicks
   * interruptible — CSS continues from where the pill actually is.
   */
  const movePillToTab = (pivotId: string, options?: { snap?: boolean }) => {
    const targetTab = tabRefs.current.get(pivotId);
    if (!targetTab) {
      return;
    }

    cancelAnimationFrame(moveRafRef.current);

    const target = readTabMetrics(targetTab);
    const pillElement = pillRef.current;
    const visual =
      pillElement && hasMeasuredRef.current
        ? readPillVisualMetrics(pillElement)
        : null;

    if (options?.snap || !visual || !pillElement) {
      hasMeasuredRef.current = true;
      slidingRef.current = false;

      // Snap must not use CSS transitions (cold load / deep link).
      if (pillElement) {
        pillElement.style.transition = "none";
      }
      flushSync(() => {
        persistPill(target, pivotId);
      });
      if (pillElement) {
        void pillElement.offsetWidth;
        pillElement.style.transition = "";
      }
      enableMotionAfterPaint();
      return;
    }

    // Freeze at the current computed geometry (no transition), sync React,
    // then aim at the new tab so an in-flight slide can reverse/retarget.
    const previousTransition = pillElement.style.transition;
    pillElement.style.transition = "none";
    pillElement.style.width = `${visual.width}px`;
    pillElement.style.height = `${visual.height}px`;
    pillElement.style.transform = `translate3d(${visual.x}px, ${visual.y}px, 0)`;
    void pillElement.offsetWidth;
    pillElement.style.transition = previousTransition;

    flushSync(() => {
      setPill(visual);
    });
    // Keep memory at the visual origin until the target lands. When no
    // transform transition will run, transitionend never fires — finalize
    // sliding/memory in the RAF instead of waiting on onPillTransitionEnd.
    pillMemory.set(key, { ...visual, pivot: pivotId });
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const willAnimate = motionEnabled && !prefersReducedMotion;
    slidingRef.current = willAnimate;
    hasMeasuredRef.current = true;
    setMotionEnabled(true);

    moveRafRef.current = requestAnimationFrame(() => {
      persistPill(target, pivotId);
      if (!willAnimate) {
        slidingRef.current = false;
      }
    });
  };

  useLayoutEffect(() => {
    const nav = scrollRef.current;
    const activeTab = tabRefs.current.get(activePivot);
    if (!nav || !activeTab) {
      return;
    }

    // Clicks drive the pill themselves so rapid re-clicks stay interruptible.
    if (clickDrivenRef.current) {
      clickDrivenRef.current = false;
    } else if (restoreForSlideRef.current) {
      // Soft-nav remount: memory is the previous tab; slide to the URL pivot.
      restoreForSlideRef.current = false;
      movePillToTab(activePivot);
    } else if (!hasMeasuredRef.current || restoreOnTargetRef.current) {
      // Cold load / deep link / remount already on the URL tab: no animation.
      restoreOnTargetRef.current = false;
      movePillToTab(activePivot, { snap: true });
    } else {
      // In-session URL sync (back/forward): animate to the new pivot.
      movePillToTab(activePivot);
    }

    const onScrollOrResize = () => {
      if (slidingRef.current) {
        return;
      }
      const tab = tabRefs.current.get(activePivot);
      if (tab) {
        persistPill(readTabMetrics(tab), activePivot);
      }
    };

    const observer = new ResizeObserver(onScrollOrResize);
    observer.observe(nav);
    observer.observe(activeTab);
    nav.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      observer.disconnect();
      nav.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
    // movePillToTab closes over key/refs; activePivot/tabIds/key are the signals.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [activePivot, tabIds, key]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(moveRafRef.current);
      cancelAnimationFrame(enableMotionRafRef.current);
    };
  }, []);

  const onPillTransitionEnd = (event: TransitionEvent<HTMLSpanElement>) => {
    if (event.propertyName !== "transform") {
      return;
    }
    slidingRef.current = false;
    const activeTab = tabRefs.current.get(activePivot);
    if (activeTab) {
      pillMemory.set(key, {
        ...readTabMetrics(activeTab),
        pivot: activePivot,
      });
    }
  };

  return {
    pill,
    motionEnabled,
    movePillToTab,
    onPillTransitionEnd,
  };
}
