import { Toast } from "@base-ui/react/toast";
import type React from "react";

export type ToastData = {
  rootProps?: Omit<
    React.ComponentProps<typeof Toast.Root>,
    "children" | "className" | "swipeDirection" | "toast"
  >;
  tooltipStyle?: boolean;
};

export const toastManager = Toast.createToastManager<ToastData>();

export const anchoredToastManager = Toast.createToastManager<ToastData>();
