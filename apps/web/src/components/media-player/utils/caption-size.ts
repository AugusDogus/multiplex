import type { CaptionSize } from "~/types/media-player";

export const CAPTION_SIZES = {
  small: { label: "Small", className: "px-2.5 py-0.5 text-sm" },
  medium: { label: "Medium", className: "px-3 py-1 text-lg" },
  large: { label: "Large", className: "px-3 py-1 text-xl" },
  "extra-large": { label: "Extra Large", className: "px-4 py-1.5 text-2xl" },
} as const satisfies Record<CaptionSize, { label: string; className: string }>;

export const CAPTION_SIZE_OPTIONS = [
  { label: CAPTION_SIZES.small.label, value: "small" },
  { label: CAPTION_SIZES.medium.label, value: "medium" },
  { label: CAPTION_SIZES.large.label, value: "large" },
  { label: CAPTION_SIZES["extra-large"].label, value: "extra-large" },
] satisfies ReadonlyArray<{ label: string; value: CaptionSize }>;
