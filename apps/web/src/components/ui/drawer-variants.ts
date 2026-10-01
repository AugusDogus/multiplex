import { cva } from "class-variance-authority";

export const drawerPopupVariants = cva("", {
  variants: {
    position: {
      bottom:
        "row-start-2 -mb-[max(0px,calc(var(--drawer-snap-point-offset,0px)+clamp(0,1,var(--drawer-snap-point-offset,0px)/1px)*var(--drawer-swipe-movement-y,0px)))] transform-[translateY(calc(var(--drawer-snap-point-offset)+var(--drawer-swipe-movement-y)))] border-t pb-[max(0px,calc(env(safe-area-inset-bottom,0px)+var(--drawer-snap-point-offset,0px)+clamp(0,1,var(--drawer-snap-point-offset,0px)/1px)*var(--drawer-swipe-movement-y,0px)))] not-data-starting-style:not-data-ending-style:transition-[transform,box-shadow,height,background-color,margin,padding] after:inset-x-0 after:top-full after:h-(--bleed) has-data-[slot=drawer-bar]:pt-2 data-ending-style:mb-0 data-ending-style:transform-[translateY(calc(100%+env(safe-area-inset-bottom,0px)+var(--inset)))] data-ending-style:pb-0 data-starting-style:mb-0 data-starting-style:transform-[translateY(calc(100%+env(safe-area-inset-bottom,0px)+var(--inset)))] data-starting-style:pb-0 h-(--drawer-height,auto) [--height:max(0px,calc(var(--drawer-frontmost-height,var(--drawer-height))))] data-nested-drawer-open:h-(--height) origin-[50%_calc(100%-var(--inset))] data-nested-drawer-open:transform-[translateY(calc(var(--drawer-swipe-movement-y)-var(--stack-peek-offset)-(var(--shrink)*var(--height))))_scale(var(--scale))]",
      top: "transform-[translateY(var(--drawer-swipe-movement-y))] border-b after:inset-x-0 after:bottom-full after:h-(--bleed) has-data-[slot=drawer-bar]:pb-2 data-ending-style:transform-[translateY(calc(-100%-var(--inset)))] data-starting-style:transform-[translateY(calc(-100%-var(--inset)))] h-(--drawer-height,auto) [--height:max(0px,calc(var(--drawer-frontmost-height,var(--drawer-height))))] data-nested-drawer-open:h-(--height) origin-[50%_var(--inset)] data-nested-drawer-open:transform-[translateY(calc(var(--drawer-swipe-movement-y)+var(--stack-peek-offset)+(var(--shrink)*var(--height))))_scale(var(--scale))]",
      left: "w-[calc(100%-(--spacing(12)))] max-w-md transform-[translateX(var(--drawer-swipe-movement-x))] border-e after:inset-y-0 after:end-full after:w-(--bleed) has-data-[slot=drawer-bar]:pe-2 data-ending-style:transform-[translateX(calc(-100%-var(--inset)))] data-starting-style:transform-[translateX(calc(-100%-var(--inset)))] origin-right data-nested-drawer-open:transform-[translateX(calc(var(--drawer-swipe-movement-x)+var(--stack-peek-offset)))_scale(var(--scale))]",
      right:
        "col-start-2 w-[calc(100%-(--spacing(12)))] max-w-md transform-[translateX(var(--drawer-swipe-movement-x))] border-s after:inset-y-0 after:start-full after:w-(--bleed) has-data-[slot=drawer-bar]:ps-2 data-ending-style:transform-[translateX(calc(100%+var(--inset)))] data-starting-style:transform-[translateX(calc(100%+var(--inset)))] origin-left data-nested-drawer-open:transform-[translateX(calc(var(--drawer-swipe-movement-x)-var(--stack-peek-offset)))_scale(var(--scale))]",
    },
    variant: {
      default: "",
      straight: "[--stack-step:0]",
      inset:
        "before:hidden sm:rounded-2xl sm:border sm:before:rounded-[calc(var(--radius-2xl)-1px)] sm:after:bg-transparent sm:**:data-[slot=drawer-footer]:rounded-b-[calc(var(--radius-2xl)-1px)]",
    },
  },
  compoundVariants: [
    {
      position: "bottom",
      variant: ["default", "inset"],
      class: "rounded-t-2xl",
    },
    {
      position: "top",
      variant: ["default", "inset"],
      class:
        "rounded-b-2xl **:data-[slot=drawer-footer]:rounded-b-[calc(var(--radius-2xl)-1px)]",
    },
    {
      position: "left",
      variant: ["default", "inset"],
      class:
        "rounded-e-2xl **:data-[slot=drawer-footer]:rounded-ee-[calc(var(--radius-2xl)-1px)]",
    },
    {
      position: "right",
      variant: ["default", "inset"],
      class:
        "rounded-s-2xl **:data-[slot=drawer-footer]:rounded-es-[calc(var(--radius-2xl)-1px)]",
    },
    {
      position: "bottom",
      variant: "default",
      class: "before:rounded-t-[calc(var(--radius-2xl)-1px)]",
    },
    {
      position: "top",
      variant: "default",
      class: "before:rounded-b-[calc(var(--radius-2xl)-1px)]",
    },
    {
      position: "left",
      variant: "default",
      class: "before:rounded-e-[calc(var(--radius-2xl)-1px)]",
    },
    {
      position: "right",
      variant: "default",
      class: "before:rounded-s-[calc(var(--radius-2xl)-1px)]",
    },
  ],
});
