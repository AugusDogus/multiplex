import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

interface MediaCarouselProps {
  children: ReactNode;
  header?: ReactNode;
  className?: string;
  gapClassName?: string;
}

/** Tailwind arbitrary variants for CSS Overflow 5 ::scroll-button() (Chrome 135+). */
const scrollButtonSupport =
  "supports-[selector(::scroll-button(left))]" as const;

const headerScrollButtonClasses = [
  "[anchor-name:--media-carousel-header]",
] as const;

const trackScrollButtonClasses = [
  `${scrollButtonSupport}:[&::scroll-button(left)]:[content:'‹'_/'Scroll_left']`,
  `${scrollButtonSupport}:[&::scroll-button(right)]:[content:'›'_/'Scroll_right']`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:absolute`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:z-10`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:hidden`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:size-8`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:cursor-pointer`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:items-center`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:justify-center`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:rounded-md`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:border`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:border-border`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:bg-background`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:text-lg`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:leading-none`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:text-foreground`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:shadow-xs`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:[position-anchor:--media-carousel-header]`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:[top:anchor(center)]`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:-mt-4`,
  `${scrollButtonSupport}:[&::scroll-button(*)]:md:inline-flex`,
  `${scrollButtonSupport}:[&::scroll-button(right)]:[right:anchor(right)]`,
  `${scrollButtonSupport}:[&::scroll-button(left)]:[right:calc(anchor(right)-2.25rem)]`,
  `${scrollButtonSupport}:[&::scroll-button(*):disabled]:hidden`,
  `${scrollButtonSupport}:[&::scroll-button(*):focus-visible]:outline-none`,
  `${scrollButtonSupport}:[&::scroll-button(*):focus-visible]:ring-[3px]`,
  `${scrollButtonSupport}:[&::scroll-button(*):focus-visible]:ring-ring/50`,
] as const;

export function MediaCarousel({
  children,
  header,
  className,
  gapClassName = "gap-4",
}: MediaCarouselProps) {
  return (
    <section className={cn("flex flex-col gap-y-4", className)}>
      {header ? (
        <div
          className={cn(
            "flex min-h-8 items-center justify-between gap-4 px-4 md:px-8",
            headerScrollButtonClasses,
          )}
        >
          <div className="min-w-0 flex-1">{header}</div>
        </div>
      ) : null}
      <div className="w-full max-w-full overflow-hidden">
        <div
          className={cn(
            "scrollbar-hide flex overflow-x-auto scroll-smooth px-4 pb-4 md:px-8",
            header && trackScrollButtonClasses,
            gapClassName,
          )}
        >
          {children}
        </div>
      </div>
    </section>
  );
}
