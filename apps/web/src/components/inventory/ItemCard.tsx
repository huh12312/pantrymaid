import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Edit, Trash2, Calendar } from "lucide-react";
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
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="font-semibold text-lg">{item.name}</h3>
            {item.category && (
              <p className="text-sm text-muted-foreground">{item.category}</p>
            )}
            <p className="text-sm mt-1">
              {item.quantity} {item.unit}
            </p>
            {item.expiryDate && (
              <div className="flex items-center gap-1 mt-2 text-sm">
                <Calendar className="h-4 w-4" />
                <span className={isExpired ? "text-destructive" : isExpiringSoon ? "text-yellow-600 dark:text-yellow-500" : "text-muted-foreground"}>
                  {new Date(item.expiryDate).toLocaleDateString()}
                </span>
              </div>
            )}
            {item.notes && (
              <p className="text-sm text-muted-foreground mt-2">{item.notes}</p>
            )}
          </div>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(item)}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(item.id)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
