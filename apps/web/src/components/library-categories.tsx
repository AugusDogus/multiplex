"use client";

import Image from "next/image";
import Link from "next/link";
import type { CategoryWithServer } from "@multiplex/plex-query";
import { getPlexImagePath } from "~/lib/plex-image";
import { getLibraryPivotHref } from "~/lib/plex-routes";

interface LibraryCategoriesProps {
  machineIdentifier: string;
  sectionId: string;
  categories: CategoryWithServer[];
}

function getCategoryParams(categoryKey: string): Record<string, string> {
  const questionIndex = categoryKey.indexOf("?");
  if (questionIndex === -1) {
    return {};
  }

  return Object.fromEntries(
    new URLSearchParams(categoryKey.slice(questionIndex + 1)),
  );
}

function getCategoryImageUrl(category: CategoryWithServer): string | undefined {
  return getPlexImagePath(category.thumb, {
    width: 640,
    height: 360,
    serverUrl: category.serverUrl,
    authToken: category.authToken,
  });
}

export function LibraryCategories({
  machineIdentifier,
  sectionId,
  categories,
}: LibraryCategoriesProps) {
  if (categories.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No categories in this library.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {categories.map((category) => {
        const imageUrl = getCategoryImageUrl(category);
        const href = getLibraryPivotHref({
          machineIdentifier,
          sectionId,
          pivot: "library",
          params: getCategoryParams(category.key),
        });

        return (
          <Link
            key={category.key}
            href={href}
            className="group bg-muted relative flex aspect-[16/9] items-center justify-center overflow-hidden rounded-lg shadow-md transition-transform active:scale-[0.99]"
          >
            {imageUrl && (
              <Image
                src={imageUrl}
                alt={category.title}
                fill
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                className="object-cover"
                loading="lazy"
              />
            )}
            <div className="absolute inset-0 bg-black/45 transition-colors group-hover:bg-black/30" />
            <span className="relative px-3 text-center text-lg font-semibold text-white drop-shadow">
              {category.title}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
