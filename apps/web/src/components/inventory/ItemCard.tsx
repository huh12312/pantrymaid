import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Edit, Trash2, Calendar, Minus, PackageOpen, ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProductImage } from "@/components/ui/ProductImage";
import { parseLocalDate } from "@/lib/dates";
import type { InventoryItem } from "@/lib/api";

interface ItemCardProps {
  item: InventoryItem;
  onEdit: (item: InventoryItem) => void;
  onDelete: (id: string) => void;
  onAdjustQuantity: (item: InventoryItem, delta: number) => void;
  onQuickUpdate: (id: string, patch: { opened?: boolean }) => void;
  isConsuming?: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export function ItemCard({
  item,
  onEdit,
  onDelete,
  onAdjustQuantity,
  onQuickUpdate,
  isConsuming,
  isExpanded,
  onToggleExpand,
}: ItemCardProps) {
  // Parse date-only strings ("YYYY-MM-DD") at local midnight, and tolerate a
  // T-suffixed ISO timestamp too — see parseLocalDate for why both matter.
  const expiryDate = item.expirationDate ? parseLocalDate(item.expirationDate) : null;

  const isExpiringSoon = expiryDate
    ? expiryDate <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    : false;

  const isExpired = expiryDate ? expiryDate < new Date() : false;

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={onToggleExpand}
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card transition-all duration-200 hover:shadow-md hover:-translate-y-0.5",
        isExpired ? "border-expired/40" : isExpiringSoon ? "border-warning/40" : "border-border"
      )}
    >
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1 rounded-l-xl",
          isExpired ? "bg-expired-accent" : isExpiringSoon ? "bg-warning-accent" : "bg-fresh-accent"
        )}
      />

      {/* Collapsed row */}
      <div className="pl-4 pr-3 py-3 flex items-start gap-3">
        {/* Trigger: image/icon + text content */}
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-controls={`item-panel-${item.id}`}
            className="flex items-start gap-3 flex-1 min-w-0 text-left"
          >
            {/* Image/icon area */}
            <ProductImage
              src={item.imageUrl}
              alt={item.name}
              className="shrink-0 h-12 w-12 md:h-14 md:w-14 rounded-xl"
            />

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <h3 className="font-semibold text-sm leading-snug truncate">{item.name}</h3>
                    {item.opened && (
                      <span title="Opened" aria-label="Opened" className="shrink-0 inline-flex">
                        <PackageOpen className="h-3 w-3 text-warning" />
                      </span>
                    )}
                  </div>
                  {item.brand && <p className="text-xs text-muted-foreground">{item.brand}</p>}
                </div>
              </div>

              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full font-medium">
                  {item.quantity} {item.unit}
                </span>
                {item.category && (
                  <span className="text-xs text-muted-foreground">{item.category}</span>
                )}
              </div>

              {item.expirationDate && expiryDate && (
                <div className="flex items-center gap-1 mt-1.5">
                  <Calendar className="h-3 w-3 shrink-0" />
                  <span
                    className={cn(
                      "text-xs",
                      isExpired
                        ? "text-expired font-medium"
                        : isExpiringSoon
                          ? "text-warning font-medium"
                          : "text-muted-foreground"
                    )}
                  >
                    {isExpired ? "Expired " : isExpiringSoon ? "Expires " : ""}
                    {expiryDate.toLocaleDateString()}
                  </span>
                </div>
              )}

              {item.notes && (
                <p className="text-xs text-muted-foreground mt-1 truncate">{item.notes}</p>
              )}

              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200 mt-1",
                  isExpanded && "rotate-180"
                )}
              />
            </div>
          </button>
        </CollapsibleTrigger>

        {/* Action buttons — sibling of trigger, NOT inside it */}
        <div className="flex gap-0.5 shrink-0 -mt-0.5 opacity-90 md:opacity-60 md:hover:opacity-100 transition-opacity">
          {item.quantity > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-lg md:h-6 md:w-6"
              title="Consume one"
              aria-label="Consume one"
              disabled={isConsuming}
              onClick={(e) => {
                e.stopPropagation();
                onAdjustQuantity(item, -1);
              }}
            >
              <Minus className="h-4 w-4 md:h-3 md:w-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Edit ${item.name}`}
            className="h-11 w-11 rounded-lg md:h-7 md:w-7"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(item);
            }}
          >
            <Edit className="h-4 w-4 md:h-3.5 md:w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${item.name}`}
            className="h-11 w-11 rounded-lg md:h-7 md:w-7"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item.id);
            }}
          >
            <Trash2 className="h-4 w-4 md:h-3.5 md:w-3.5 text-destructive" />
          </Button>
        </div>
      </div>

      {/* Expanded panel */}
      <CollapsibleContent
        id={`item-panel-${item.id}`}
        className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up"
      >
        {/* 1. Stepper */}
        <div className="border-t border-border bg-muted/50 px-4 py-3 flex items-center justify-center gap-4">
          <Button
            variant="outline"
            className="h-11 w-11 rounded-lg md:h-9 md:w-9"
            aria-label="Decrease quantity"
            disabled={item.quantity <= 0 || isConsuming}
            onClick={() => onAdjustQuantity(item, -1)}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span className="min-w-[5rem] text-center font-semibold text-base">
            {Math.round(item.quantity * 100) / 100} {item.unit}
          </span>
          <Button
            variant="outline"
            className="h-11 w-11 rounded-lg md:h-9 md:w-9"
            aria-label="Increase quantity"
            disabled={isConsuming}
            onClick={() => onAdjustQuantity(item, 1)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* 2. Opened toggle */}
        <div className="border-t border-border bg-muted/50 px-4 py-2.5 flex items-center gap-2">
          <Checkbox
            id={`opened-${item.id}`}
            checked={item.opened ?? false}
            onCheckedChange={(c) => onQuickUpdate(item.id, { opened: c === true })}
          />
          <label htmlFor={`opened-${item.id}`} className="text-sm">
            Mark as opened
          </label>
        </div>

        {/* 3. Details read-out */}
        <div className="border-t border-border bg-muted/30 px-4 py-3 space-y-1.5">
          {item.category && (
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs text-muted-foreground w-20 shrink-0">Category</span>
              <span className="text-sm text-right">{item.category}</span>
            </div>
          )}
          {item.location && (
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs text-muted-foreground w-20 shrink-0">Location</span>
              <span className="text-sm text-right">
                {item.location.charAt(0).toUpperCase() + item.location.slice(1)}
              </span>
            </div>
          )}
          {item.expirationDate && expiryDate && (
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs text-muted-foreground w-20 shrink-0">Expires</span>
              <span
                className={cn(
                  "text-sm text-right",
                  isExpired
                    ? "text-expired font-medium"
                    : isExpiringSoon
                      ? "text-warning font-medium"
                      : ""
                )}
              >
                {expiryDate.toLocaleDateString()}
              </span>
            </div>
          )}
          {item.notes && (
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs text-muted-foreground w-20 shrink-0">Notes</span>
              <span className="text-sm text-right">{item.notes}</span>
            </div>
          )}
        </div>

        {/* 4. Actions */}
        <div className="border-t border-border bg-muted/50 px-4 py-3 flex items-center justify-between gap-2">
          <Button variant="outline" className="h-11 sm:h-10 text-sm" onClick={() => onEdit(item)}>
            Edit details
          </Button>
          <Button
            variant="ghost"
            className="h-11 sm:h-10 text-sm text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => onDelete(item.id)}
          >
            Delete item
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
