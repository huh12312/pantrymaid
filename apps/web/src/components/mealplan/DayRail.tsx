import { parseLocalDate, monthAbbreviation } from "@/lib/dates";
import { cn } from "@/lib/utils";

const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface DayRailDay {
  dayIndex: number;
  date: string;
}

export interface DayRailProps {
  days: DayRailDay[];
  activeDayIndex: number;
  onJump: (dayIndex: number) => void;
}

/**
 * Jump rail (plan §5.2). Deliberately `<nav aria-label="Jump to day">` with plain
 * buttons, NOT `role="tablist"` — every day renders simultaneously in the stack
 * below, so tab semantics (which imply only one panel is visible) would lie to a
 * screen reader. `aria-current` is driven by the caller's scroll-tracked index.
 */
export function DayRail({ days, activeDayIndex, onJump }: DayRailProps) {
  return (
    <nav
      aria-label="Jump to day"
      className="sticky top-16 z-20 flex gap-1 overflow-x-auto bg-background/95 px-4 py-2 backdrop-blur md:top-0 md:px-6"
    >
      {days.map(({ dayIndex, date }) => {
        const parsed = parseLocalDate(date);
        const active = dayIndex === activeDayIndex;
        return (
          <button
            key={dayIndex}
            type="button"
            onClick={() => onJump(dayIndex)}
            aria-current={active ? "true" : undefined}
            className={cn(
              "flex min-h-11 min-w-11 flex-col items-center justify-center rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <span>{parsed ? WEEKDAY_ABBR[parsed.getDay()] : ""}</span>
            <span className="text-[11px] opacity-80">
              {parsed ? `${monthAbbreviation(parsed.getMonth())} ${parsed.getDate()}` : ""}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
