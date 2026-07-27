import { Toast } from "@base-ui/react/toast";

export const toastManager: ReturnType<typeof Toast.createToastManager> =
  Toast.createToastManager();

export const anchoredToastManager: ReturnType<typeof Toast.createToastManager> =
  Toast.createToastManager();
