"use client";

import { useState } from "react";

interface DetailsSynopsisProps {
  summary: string;
}

const COLLAPSED_MAX_CHARS = 280;

export function DetailsSynopsis({ summary }: DetailsSynopsisProps) {
  const [expanded, setExpanded] = useState(false);
  const isTruncatable = summary.length > COLLAPSED_MAX_CHARS;
  const displayText =
    expanded || !isTruncatable
      ? summary
      : `${summary.slice(0, COLLAPSED_MAX_CHARS).trimEnd()}…`;

  return (
    <section
      aria-labelledby="details-synopsis-heading"
      className="bg-card ring-border/60 rounded-2xl p-5 shadow-sm ring-1"
    >
      <h2
        id="details-synopsis-heading"
        className="text-foreground mb-3 text-base font-semibold tracking-tight"
      >
        About
      </h2>
      <p className="text-foreground/90 text-[15px] leading-7 sm:text-base sm:leading-8">
        {displayText}
      </p>
      {isTruncatable && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="text-primary mt-3 text-sm font-medium hover:underline"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </section>
  );
}
