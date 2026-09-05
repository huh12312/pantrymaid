import * as React from "react";
import { cn } from "@/lib/utils";

export type Section = "all" | "pantry" | "fridge" | "freezer";

export interface SegmentedTabsOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedTabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedTabsOption<T>[];
  ariaLabel: string;
  counts?: Partial<Record<T, number>>;
  className?: string;
}

/** Default options/label for the inventory location tabs (Inventory usage). */
export const INVENTORY_LOCATION_TABS: SegmentedTabsOption<Section>[] = [
  { value: "all", label: "All" },
  { value: "pantry", label: "Pantry" },
  { value: "fridge", label: "Fridge" },
  { value: "freezer", label: "Freezer" },
];

export const INVENTORY_LOCATION_ARIA_LABEL = "Inventory location";

export function SegmentedTabs<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  counts,
  className,
}: SegmentedTabsProps<T>) {
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = (index + direction + options.length) % options.length;
    const nextTab = options[next];
    if (!nextTab) return;
    tabRefs.current[next]?.focus();
    onChange(nextTab.value);
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("flex w-full items-center gap-1 rounded-full bg-muted p-1", className)}
    >
      {options.map((tab, index) => {
        const selected = tab.value === value;
        const count = counts?.[tab.value];
        return (
          <button
            key={tab.value}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span>{tab.label}</span>
            {typeof count === "number" ? (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs",
                  selected
                    ? "bg-primary/10 text-primary"
                    : "bg-muted-foreground/20 text-muted-foreground"
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
