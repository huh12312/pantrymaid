import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Edit, Trash2, Calendar, Package } from "lucide-react";
import type { InventoryItem } from "@/lib/api";

interface ItemCardProps {
  item: InventoryItem;
  onEdit: (item: InventoryItem) => void;
  onDelete: (id: string) => void;
}

export function ItemCard({ item, onEdit, onDelete }: ItemCardProps) {
  const isExpiringSoon = item.expiryDate
    ? new Date(item.expiryDate) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    : false;

  const isExpired = item.expiryDate
    ? new Date(item.expiryDate) < new Date()
    : false;

  return (
    <Card className={isExpired ? "border-destructive" : isExpiringSoon ? "border-yellow-500" : ""}>
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          {/* Product image */}
          <div className="flex-shrink-0 w-16 h-16 rounded-md overflow-hidden bg-muted flex items-center justify-center">
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt={item.name}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                  e.currentTarget.nextElementSibling?.removeAttribute("style");
                }}
              />
            ) : null}
            <Package
              className="h-7 w-7 text-muted-foreground"
              style={item.imageUrl ? { display: "none" } : undefined}
            />
          </div>

          {/* Item details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-1">
              <div className="min-w-0">
                <h3 className="font-semibold leading-tight truncate">{item.name}</h3>
                {item.brand && (
                  <p className="text-xs text-muted-foreground">{item.brand}</p>
                )}
              </div>
              <div className="flex gap-1 flex-shrink-0 -mt-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(item)}>
                  <Edit className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(item.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>

            <p className="text-sm mt-0.5">
              {item.quantity} {item.unit}
              {item.category && (
                <span className="text-muted-foreground"> · {item.category}</span>
              )}
            </p>

            {item.expiryDate && (
              <div className="flex items-center gap-1 mt-1 text-xs">
                <Calendar className="h-3 w-3" />
                <span className={isExpired ? "text-destructive font-medium" : isExpiringSoon ? "text-yellow-600 dark:text-yellow-500 font-medium" : "text-muted-foreground"}>
                  {isExpired ? "Expired " : isExpiringSoon ? "Expires " : ""}
                  {new Date(item.expiryDate).toLocaleDateString()}
                </span>
              </div>
            )}

            {item.notes && (
              <p className="text-xs text-muted-foreground mt-1 truncate">{item.notes}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
