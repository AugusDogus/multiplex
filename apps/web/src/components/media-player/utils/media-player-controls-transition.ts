/** Strong ease-out — enter slightly slower than exit (asymmetric). */
export const mediaPlayerControlsTransition = {
  base: "transition-opacity ease-[cubic-bezier(0.23,1,0.32,1)]",
  visible: "opacity-100 duration-200",
  hidden:
    "pointer-events-none opacity-0 duration-150 [&_*]:pointer-events-none",
} as const;
