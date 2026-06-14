/** Matches MediaPosterCard row layout: 120 → 140 (sm) → 160 (md). */
export const POSTER_WIDTH_CLASSNAME = "w-[120px] sm:w-[140px] md:w-[160px]";

export const POSTER_HEIGHT_CLASSNAME =
  "h-[180px] sm:h-[210px] md:h-[240px]";

export const POSTER_GRID_ROW_CLASSNAME = "grid gap-x-3 pb-5 sm:gap-x-4";

export const POSTER_GRID_CONTAINER_CLASSNAME = "w-full min-w-0";

export const POSTER_GRID_DEFAULT_COLUMNS = 6;

export function getPosterTargetWidth(viewportWidth: number): number {
  if (viewportWidth >= 768) {
    return 160;
  }
  if (viewportWidth >= 640) {
    return 140;
  }
  return 120;
}

export function getPosterGridGap(viewportWidth: number): number {
  return viewportWidth >= 640 ? 16 : 12;
}

/** Prefer enough columns that fixed-width tracks fit without overflowing. */
export function getPosterGridColumnsForWidth(
  trackWidth: number,
  viewportWidth: number,
): number {
  const targetWidth = getPosterTargetWidth(viewportWidth);
  const gap = getPosterGridGap(viewportWidth);
  return Math.max(1, Math.floor((trackWidth + gap) / (targetWidth + gap)));
}

export function getPosterGridColumnsStyle(
  columns: number,
  viewportWidth: number,
): {
  gridTemplateColumns: string;
} {
  const targetWidth = getPosterTargetWidth(viewportWidth);
  return {
    gridTemplateColumns: `repeat(${columns}, ${targetWidth}px)`,
  };
}

export function getPosterHeight(viewportWidth: number): number {
  if (viewportWidth >= 768) {
    return 240;
  }
  if (viewportWidth >= 640) {
    return 210;
  }
  return 180;
}

/** Matches MediaPosterCard grid cell: poster + gap-2 + title + subtitle + row pb-5. */
export function getPosterGridRowHeightEstimate(viewportWidth: number): number {
  const cardGap = 8;
  const titleLine = 18;
  const subtitleLine = 15;
  const rowPadding = 20;
  return (
    getPosterHeight(viewportWidth) + cardGap + titleLine + subtitleLine + rowPadding
  );
}

export function measurePosterGridTrackWidth(element: HTMLElement): number {
  const styles = window.getComputedStyle(element);
  const horizontalPadding =
    parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  return element.clientWidth - horizontalPadding;
}

/** Sidebar (16rem) + AppPageContent horizontal padding (p-4 × 2) on md+. */
const SIDEBAR_WIDTH_PX = 256;
const PAGE_HORIZONTAL_PADDING_PX = 32;

/** Estimate grid track width before the container ref is measured. */
export function estimatePosterGridTrackWidth(viewportWidth: number): number {
  if (viewportWidth >= 768) {
    return Math.max(
      0,
      viewportWidth - SIDEBAR_WIDTH_PX - PAGE_HORIZONTAL_PADDING_PX,
    );
  }
  return Math.max(0, viewportWidth - PAGE_HORIZONTAL_PADDING_PX);
}
