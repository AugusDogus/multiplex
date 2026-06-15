import { cn } from "~/lib/utils";

/** Search chrome collapses to an icon when the header has centered content. */
export function getAppHeaderSearchWrapperClassName(centerLayout: boolean) {
  return centerLayout
    ? "hidden w-fit md:block"
    : "hidden w-fit sm:ml-auto sm:w-auto md:block md:w-full";
}

export function getAppHeaderSearchIconClassName(collapseAtContainer: boolean) {
  return cn(
    "h-8 w-8 p-0",
    collapseAtContainer
      ? "hidden md:inline-flex @5xl/appheader:hidden"
      : "md:hidden",
  );
}

export function getAppHeaderSearchInputClassName(collapseAtContainer: boolean) {
  return cn(
    "relative hidden cursor-pointer",
    collapseAtContainer ? "@5xl/appheader:block" : "md:block",
  );
}

export function getAppHeaderSearchSkeletonIconClassName(
  collapseAtContainer: boolean,
) {
  return cn(
    "size-8 rounded-md",
    collapseAtContainer
      ? "hidden md:inline-flex @5xl/appheader:hidden"
      : "md:hidden",
  );
}

export function getAppHeaderSearchSkeletonInputClassName(
  collapseAtContainer: boolean,
) {
  return cn(
    "relative hidden",
    collapseAtContainer ? "@5xl/appheader:block" : "md:block",
  );
}
