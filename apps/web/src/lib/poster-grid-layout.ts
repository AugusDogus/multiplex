/** Vertical spacing between poster rows (matches Tailwind gap-y-5). */
export const POSTER_GRID_ROW_GAP_PX = 20;

export const POSTER_GRID_INSET_CLASSNAME = "px-4 md:px-8";

const POSTER_WIDTH_PX = {
  base: 120,
  sm: 140,
  md: 160,
} as const;

const POSTER_HEIGHT_PX = {
  base: 180,
  sm: 210,
  md: 240,
} as const;

const POSTER_GRID_COLUMN_GAP_PX = {
  base: 12,
  sm: 16,
} as const;

function getPosterWidth(viewportWidth: number): number {
  if (viewportWidth >= 768) {
    return POSTER_WIDTH_PX.md;
  }
  if (viewportWidth >= 640) {
    return POSTER_WIDTH_PX.sm;
  }
  return POSTER_WIDTH_PX.base;
}

function getPosterGridColumnGap(viewportWidth: number): number {
  return viewportWidth >= 640
    ? POSTER_GRID_COLUMN_GAP_PX.sm
    : POSTER_GRID_COLUMN_GAP_PX.base;
}

/** Prefer enough columns that fixed-width tracks fit without overflowing. */
export function getPosterGridColumnsForWidth(
  trackWidth: number,
  viewportWidth: number,
): number {
  const targetWidth = getPosterWidth(viewportWidth);
  const gap = getPosterGridColumnGap(viewportWidth);
  return Math.max(1, Math.floor((trackWidth + gap) / (targetWidth + gap)));
}

export function getPosterGridTemplateColumns(
  columnCount: number,
  viewportWidth: number,
): string {
  const targetWidth = getPosterWidth(viewportWidth);
  return `repeat(${columnCount}, minmax(${targetWidth}px, 1fr))`;
}

function getPosterHeight(viewportWidth: number): number {
  if (viewportWidth >= 768) {
    return POSTER_HEIGHT_PX.md;
  }
  if (viewportWidth >= 640) {
    return POSTER_HEIGHT_PX.sm;
  }
  return POSTER_HEIGHT_PX.base;
}

/** Poster card stack only; excludes inter-row gap. */
export function getPosterGridRowContentHeight(viewportWidth: number): number {
  const cardGap = 8;
  const titleLine = 18;
  const subtitleLine = 15;
  return getPosterHeight(viewportWidth) + cardGap + titleLine + subtitleLine;
}

export function measurePosterGridTrackWidth(element: HTMLElement): number {
  const styles = window.getComputedStyle(element);
  const horizontalPadding =
    parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  return element.clientWidth - horizontalPadding;
}

/** Expanded sidebar (16rem) + AppPageContent horizontal padding (p-4 x 2) on md+. */
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
