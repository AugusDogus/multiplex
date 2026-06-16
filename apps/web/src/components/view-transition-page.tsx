import { ViewTransition, type ReactNode } from "react";

import {
  DIRECTIONAL_ENTER,
  DIRECTIONAL_EXIT,
} from "~/lib/view-transitions";

interface ViewTransitionPageProps {
  children: ReactNode;
}

export function ViewTransitionPage({ children }: ViewTransitionPageProps) {
  return (
    <ViewTransition
      enter={DIRECTIONAL_ENTER}
      exit={DIRECTIONAL_EXIT}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}
