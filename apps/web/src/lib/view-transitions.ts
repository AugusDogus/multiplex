export const NAV_FORWARD = "nav-forward";
export const NAV_BACK = "nav-back";

export const NAV_FORWARD_TYPES = [NAV_FORWARD] as const;
export const NAV_BACK_TYPES = [NAV_BACK] as const;

export const DIRECTIONAL_ENTER = {
  [NAV_FORWARD]: NAV_FORWARD,
  [NAV_BACK]: NAV_BACK,
  default: "none",
} as const;

export const DIRECTIONAL_EXIT = {
  [NAV_FORWARD]: NAV_FORWARD,
  [NAV_BACK]: NAV_BACK,
  default: "none",
} as const;

export function getPosterTransitionName(ratingKey: string): string {
  return `poster-${ratingKey}`;
}
