import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  // Start with false to match server-side prerender (no window available)
  // This prevents hydration mismatch flashes
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    // Check immediately on mount
    const checkMobile = () => window.innerWidth < MOBILE_BREAKPOINT;
    setIsMobile(checkMobile());

    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(checkMobile());
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
