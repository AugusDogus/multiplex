import type { ComponentProps } from "react";

import { Text as NativeText } from "react-native";

export function Text({ className, ...props }: ComponentProps<typeof NativeText>) {
  return <NativeText className={`text-foreground text-base ${className ?? ""}`} {...props} />;
}
