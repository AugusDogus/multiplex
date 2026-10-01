// Adapted from T3 Code, MIT. See public/licenses/t3-code/NOTICE.
import { cn } from "~/lib/utils";
import type { ThemeCardPreviewColors } from "./theme-preview-circles";

// A simple miniature of the app: sidebar, a short conversation, the
// composer, and the orchestrator panel floating over the interface as an
// island with horizontal agent rows.
export function ThemeWireframePane({
  colors,
  clip,
}: {
  colors: ThemeCardPreviewColors;
  clip?: "left" | "right" | undefined;
}) {
  const line = "rgb(127 127 127 / 0.25)";
  return (
    <span
      className="absolute inset-0"
      style={
        clip === undefined
          ? undefined
          : {
              clipPath:
                clip === "left"
                  ? "polygon(0 0, calc(50% - 1px) 0, calc(50% - 1px) 100%, 0 100%)"
                  : "polygon(calc(50% + 1px) 0, 100% 0, 100% 100%, calc(50% + 1px) 100%)",
            }
      }
    >
      <span
        className="absolute inset-0"
        style={{ backgroundColor: colors.canvas }}
      />
      <span
        className="absolute inset-y-0 left-0 w-[22%]"
        style={{
          backgroundColor: colors.sidebar,
          boxShadow: `inset -1px 0 0 ${line}`,
        }}
      />

      {/* Sidebar: search, then thread rows */}
      <span
        className="absolute top-[8%] left-[3%] h-[8%] w-[16%] rounded-[8px]"
        style={{
          backgroundColor: colors.surface,
          boxShadow: `inset 0 0 0 1px ${line}`,
        }}
      />
      <span
        className="absolute top-[22%] left-[3%] h-[7%] w-[16%] rounded-[8px]"
        style={{ backgroundColor: colors.accentSurface }}
      />
      <span
        className="absolute top-[32%] left-[3%] h-[7%] w-[16%] rounded-[8px]"
        style={{ backgroundColor: colors.messageSurface, opacity: 0.7 }}
      />
      <span
        className="absolute top-[42%] left-[3%] h-[7%] w-[16%] rounded-[8px]"
        style={{ backgroundColor: colors.messageSurface, opacity: 0.5 }}
      />

      {/* Conversation */}
      <span
        className="absolute top-[11%] right-[28%] h-[9%] w-[24%] rounded-[10px]"
        style={{ backgroundColor: colors.messageSurface }}
      />
      <span
        className="absolute top-[28%] left-[27%] h-[5%] w-[34%] rounded-[6px]"
        style={{ backgroundColor: line }}
      />
      <span
        className="absolute top-[38%] left-[27%] h-[5%] w-[26%] rounded-[6px]"
        style={{ backgroundColor: line }}
      />

      {/* Composer */}
      <span
        className="absolute right-[6%] bottom-[8%] left-[26%] flex h-[15%] items-center justify-between rounded-[8px] px-[2.5%]"
        style={{
          backgroundColor: colors.surface,
          boxShadow: `inset 0 0 0 1px ${line}`,
        }}
      >
        <span
          className="block h-[26%] w-[34%] rounded-full"
          style={{ backgroundColor: line, opacity: 0.7 }}
        />
        <span
          className="block aspect-square h-[58%] rounded-full"
          style={{ backgroundColor: colors.messageAction }}
        />
      </span>

      {/* Orchestrator island floating over the composer */}
      <span
        className="absolute top-[8%] right-[5%] h-[46%] w-[20%] rounded-[10px]"
        style={{
          backgroundColor: colors.surface,
          boxShadow: `inset 0 0 0 1px ${line}, 0 2px 5px rgb(0 0 0 / 0.14)`,
        }}
      >
        {[0, 1, 2].map((row) => (
          <span
            className="absolute right-[11%] left-[11%] flex items-center gap-[5%]"
            key={row}
            style={{ top: `${10 + row * 30}%`, height: "20%" }}
          >
            <span
              className="block aspect-square h-[26%] rounded-full"
              style={{
                backgroundColor:
                  row === 0
                    ? "#34d399"
                    : row === 1
                      ? colors.messageAction
                      : "#fbbf24",
                opacity: 0.55,
              }}
            />
            <span
              className="block h-[30%] w-[52%] rounded-[6px]"
              style={{ backgroundColor: line }}
            />
          </span>
        ))}
      </span>
    </span>
  );
}

export function ThemeWireframe({
  className,
  panes,
}: {
  /** Sizing (height) for the frame; the pane geometry is percentage based. */
  className?: string;
  panes: ReadonlyArray<{
    colors: ThemeCardPreviewColors;
    clip?: "left" | "right";
  }>;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "border-border/60 relative block w-full overflow-hidden rounded-[10px] border",
        className,
      )}
    >
      {panes.map((pane) => (
        <ThemeWireframePane
          clip={pane.clip}
          colors={pane.colors}
          key={pane.clip ?? "pane"}
        />
      ))}
    </span>
  );
}
