import { Button } from "@/components/ui/button";
import { Edit, Trash2, Calendar, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InventoryItem } from "@/lib/api";

interface ItemCardProps {
  item: InventoryItem;
  onEdit: (item: InventoryItem) => void;
  onDelete: (id: string) => void;
}

export function ItemCard({ item, onEdit, onDelete }: ItemCardProps) {
  const isExpiringSoon = item.expirationDate
    ? new Date(item.expirationDate) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    : false;

  const isExpired = item.expirationDate
    ? new Date(item.expirationDate) < new Date()
    : false;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card transition-all duration-200 hover:shadow-md hover:-translate-y-0.5",
        isExpired
          ? "border-rose-200 dark:border-rose-900/50"
          : isExpiringSoon
            ? "border-amber-200 dark:border-amber-900/50"
            : "border-border",
      )}
    >
      {/* Left status stripe */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1 rounded-l-xl",
          isExpired ? "bg-rose-500" : isExpiringSoon ? "bg-amber-400" : "bg-emerald-400",
        )}
      />

      {/* Content area */}
      <div className="pl-4 pr-3 py-3 flex items-start gap-3">
        {/* Image/icon area */}
        <div className="flex-shrink-0 w-12 h-12 rounded-xl overflow-hidden bg-secondary flex items-center justify-center">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
                const sibling = e.currentTarget.nextElementSibling as HTMLElement | null;
                if (sibling) sibling.style.display = "flex";
              }}
            />
          ) : null}
          <Package
            className="h-5 w-5 text-muted-foreground"
            style={item.imageUrl ? { display: "none" } : undefined}
          />
        </div>

        {/* Text content block */}
        <div className="flex-1 min-w-0">
          {/* Name row with action buttons */}
          <div className="flex items-start justify-between gap-1">
            <div className="min-w-0">
              <h3 className="font-semibold text-sm leading-snug truncate">{item.name}</h3>
              {item.brand && <p className="text-xs text-muted-foreground">{item.brand}</p>}
            </div>
            <div className="flex gap-0.5 flex-shrink-0 -mt-0.5 opacity-60 hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-lg"
                onClick={() => onEdit(item)}
              >
                <Edit className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-lg"
                onClick={() => onDelete(item.id)}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          </div>

          {/* Quantity + category row */}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full font-medium">
              {item.quantity} {item.unit}
            </span>
            {item.category && (
              <span className="text-xs text-muted-foreground">{item.category}</span>
            )}
          </div>

          {/* Expiry date */}
          {item.expirationDate && (
            <div className="flex items-center gap-1 mt-1.5">
              <Calendar className="h-3 w-3 flex-shrink-0" />
              <span
                className={cn(
                  "text-xs",
                  isExpired
                    ? "text-rose-500 font-medium"
                    : isExpiringSoon
                      ? "text-amber-500 font-medium"
                      : "text-muted-foreground",
                )}
              >
                {isExpired ? "Expired " : isExpiringSoon ? "Expires " : ""}
                {new Date(item.expirationDate).toLocaleDateString()}
              </span>
            </div>
          )}

          {/* Notes */}
          {item.notes && (
            <p className="text-xs text-muted-foreground mt-1 truncate">{item.notes}</p>
          )}
        </div>
      </div>
    </div>
  );
}
