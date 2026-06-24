/** Vertical spacing between poster rows (matches Tailwind gap-y-5). */
export const POSTER_GRID_ROW_GAP_PX = 20;

export const POSTER_GRID_INSET_CLASSNAME = "px-4 md:px-8";

export const POSTER_WIDTH_PX = 160;
export const POSTER_HEIGHT_PX = 240;

const POSTER_GRID_COLUMN_GAP_PX = {
  base: 12,
  sm: 16,
} as const;

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
  const gap = getPosterGridColumnGap(viewportWidth);
  return Math.max(1, Math.floor((trackWidth + gap) / (POSTER_WIDTH_PX + gap)));
}

export function getPosterGridTemplateColumns(columnCount: number): string {
  return `repeat(${columnCount}, minmax(${POSTER_WIDTH_PX}px, 1fr))`;
}

/** Poster card stack only; excludes inter-row gap. */
export const POSTER_GRID_ROW_CONTENT_HEIGHT_PX = POSTER_HEIGHT_PX + 8 + 18 + 15;

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
