import type { CSSProperties, MouseEvent, ReactNode } from "react";
import type { Bar } from "@/lib/calendar-bars";

/**
 * Absolutely positioned booking bars over a row of day cells (see lib/calendar-bars.ts for the layout).
 * The overlay ignores clicks except on the bars, so clicking an empty part of a day still reaches the day cell.
 */
export function CalendarBarsOverlay<T>({ bars, top, laneHeight, barHeight, onOpen, look, label, title, testId }: {
  bars: Bar<T>[];
  top: number;
  laneHeight: number;
  barHeight: number;
  onOpen: (item: T, e: MouseEvent) => void;
  look: (item: T) => { className?: string; style?: CSSProperties };
  label: (item: T) => ReactNode;
  title: (item: T) => string;
  testId?: (item: T) => string;
}) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {bars.map(b => {
        const l = look(b.item);
        const inset = 2; // px gap only at the rounded (check-in / checkout) ends
        return (
          <button
            type="button"
            key={`${(b.item as any).id}-${b.left}`}
            data-testid={testId?.(b.item)}
            onClick={e => { e.stopPropagation(); onOpen(b.item, e); }}
            title={title(b.item)}
            aria-label={title(b.item)}
            className={["absolute pointer-events-auto flex items-center text-left text-[10px] leading-none font-medium px-1.5 overflow-hidden whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-ring", l.className ?? ""].join(" ")}
            style={{
              ...l.style,
              left: `calc(${b.left * 100}% + ${b.roundStart ? inset : 0}px)`,
              width: `calc(${b.width * 100}% - ${(b.roundStart ? inset : 0) + (b.roundEnd ? inset : 0)}px)`,
              top: top + b.lane * laneHeight,
              height: barHeight,
              borderRadius: `${b.roundStart ? 999 : 0}px ${b.roundEnd ? 999 : 0}px ${b.roundEnd ? 999 : 0}px ${b.roundStart ? 999 : 0}px`,
            }}
          >
            {b.showLabel && label(b.item)}
          </button>
        );
      })}
    </div>
  );
}
