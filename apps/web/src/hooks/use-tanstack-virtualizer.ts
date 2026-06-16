"use client";

import { useVirtualizer } from "@tanstack/react-virtual";

/**
 * TanStack Virtual mutates its virtualizer instance in place. Keep the React
 * Compiler boundary here so app components can use a named project hook instead
 * of scattering compiler-rule suppressions around product code.
 */
export function useTanStackVirtualizer<
  TScrollElement extends Element,
  TItemElement extends Element,
>(options: Parameters<typeof useVirtualizer<TScrollElement, TItemElement>>[0]) {
  "use no memo";

  // TODO: Remove this wrapper/suppression when TanStack Virtual resolves
  // https://github.com/TanStack/virtual/issues/1119.
  // eslint-disable-next-line react-hooks/incompatible-library -- Official TanStack adapter mutates its returned virtualizer instance.
  return useVirtualizer<TScrollElement, TItemElement>(options);
}
