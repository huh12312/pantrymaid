import { useState } from "react";
import { Minus, Plus, ShoppingBag, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProductImage } from "@/components/ui/ProductImage";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import type { ReceiptProcessingResult } from "@pantrymaid/shared/schemas";
import type { ItemLocation } from "@pantrymaid/shared/schemas";
import type { CreateItemDto } from "@/lib/api";

interface ReviewItem {
  selected: boolean;
  name: string;
  quantity: number;
  location: ItemLocation;
  price?: number;
  confidence: number;
  imageUrl?: string;
  brand?: string;
  category?: string;
}

interface ReceiptReviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receiptData: ReceiptProcessingResult;
  onConfirm: (items: CreateItemDto[]) => void;
  isSubmitting: boolean;
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence >= 0.8) return null;
  if (confidence >= 0.5) {
    return <span className="text-xs px-1.5 py-0.5 rounded bg-warning/15 text-warning">review</span>;
  }
  return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-expired/15 text-expired">low confidence</span>
  );
}

export function ReceiptReviewSheet({
  open,
  onOpenChange,
  receiptData,
  onConfirm,
  isSubmitting,
}: ReceiptReviewSheetProps) {
  const [items, setItems] = useState<ReviewItem[]>(() =>
    receiptData.lineItems.map((item) => ({
      selected: true,
      name: item.decoded,
      quantity: item.quantity ?? 1,
      location: "pantry" as ItemLocation,
      price: item.price,
      confidence: item.confidence,
      imageUrl: item.matchedProduct?.imageUrl,
      brand: item.matchedProduct?.brand,
      category: item.matchedProduct?.category ?? undefined,
    }))
  );

  const selectedCount = items.filter((i) => i.selected).length;

  const updateItem = (index: number, patch: Partial<ReviewItem>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const handleSelectAll = () => {
    const allSelected = items.every((i) => i.selected);
    setItems((prev) => prev.map((item) => ({ ...item, selected: !allSelected })));
  };

  const handleBulkLocation = (location: ItemLocation) => {
    setItems((prev) => prev.map((item) => (item.selected ? { ...item, location } : item)));
  };

  const handleConfirm = () => {
    const toAdd: CreateItemDto[] = items
      .filter((item) => item.selected)
      .map((item) => ({
        name: item.name,
        quantity: item.quantity,
        location: item.location,
        brand: item.brand,
        category: item.category,
        imageUrl: item.imageUrl,
        unit: "unit",
      }));
    onConfirm(toAdd);
  };

  const allSelected = items.length > 0 && items.every((i) => i.selected);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showHandle className="flex flex-col">
        <SheetHeader className="shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5" />
            Review Receipt Items
          </SheetTitle>
          {(receiptData.storeName || receiptData.total !== undefined) && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              {receiptData.storeName && (
                <span className="flex items-center gap-1">
                  <Store className="h-3.5 w-3.5" />
                  {receiptData.storeName}
                </span>
              )}
              {receiptData.total !== undefined && (
                <span>Total: ${receiptData.total.toFixed(2)}</span>
              )}
            </div>
          )}
        </SheetHeader>

        {/* Bulk actions */}
        <div className="flex items-center gap-2 py-2 shrink-0 border-b">
          <button
            onClick={handleSelectAll}
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
          {selectedCount > 0 && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">Set location:</span>
              <Select onValueChange={(v) => handleBulkLocation(v as ItemLocation)}>
                <SelectTrigger className="h-7 w-28 text-xs">
                  <SelectValue placeholder="All…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pantry">Pantry</SelectItem>
                  <SelectItem value="fridge">Fridge</SelectItem>
                  <SelectItem value="freezer">Freezer</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
        </div>

        {/* Item list */}
        <div className="flex-1 overflow-y-auto py-2 space-y-3">
          {items.map((item, index) => (
            <div
              key={index}
              className={`flex gap-3 p-3 rounded-lg border transition-colors ${
                item.selected
                  ? "border-border bg-background"
                  : "border-transparent bg-muted/40 opacity-60"
              }`}
            >
              <Checkbox
                id={`item-${index}`}
                checked={item.selected}
                onCheckedChange={(checked) => updateItem(index, { selected: !!checked })}
                className="mt-1 shrink-0"
              />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-start gap-2 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <Label htmlFor={`name-${index}`} className="sr-only">
                      Item name
                    </Label>
                    <Input
                      id={`name-${index}`}
                      value={item.name}
                      onChange={(e) => updateItem(index, { name: e.target.value })}
                      className="h-8 text-sm"
                      disabled={!item.selected}
                    />
                  </div>
                  <ConfidenceBadge confidence={item.confidence} />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Quantity */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        updateItem(index, { quantity: Math.max(1, item.quantity - 1) })
                      }
                      disabled={!item.selected}
                      className="h-7 w-7 rounded border flex items-center justify-center hover:bg-muted disabled:opacity-40"
                      aria-label="Decrease quantity"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="text-sm w-6 text-center">{item.quantity}</span>
                    <button
                      onClick={() => updateItem(index, { quantity: item.quantity + 1 })}
                      disabled={!item.selected}
                      className="h-7 w-7 rounded border flex items-center justify-center hover:bg-muted disabled:opacity-40"
                      aria-label="Increase quantity"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                  {/* Location */}
                  <Select
                    value={item.location}
                    onValueChange={(v) => updateItem(index, { location: v as ItemLocation })}
                    disabled={!item.selected}
                  >
                    <SelectTrigger className="h-7 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pantry">Pantry</SelectItem>
                      <SelectItem value="fridge">Fridge</SelectItem>
                      <SelectItem value="freezer">Freezer</SelectItem>
                    </SelectContent>
                  </Select>
                  {item.price !== undefined && (
                    <span className="text-xs text-muted-foreground">${item.price.toFixed(2)}</span>
                  )}
                </div>
              </div>
              {item.imageUrl && (
                <ProductImage
                  src={item.imageUrl}
                  alt={item.name}
                  className="h-12 w-12 shrink-0 rounded"
                />
              )}
            </div>
          ))}
        </div>

        <SheetFooter className="shrink-0 pt-2">
          <Button
            className="w-full h-11 sm:h-10"
            onClick={handleConfirm}
            disabled={selectedCount === 0 || isSubmitting}
          >
            {isSubmitting
              ? "Adding items…"
              : selectedCount === 0
                ? "Select items to add"
                : `Add ${selectedCount} item${selectedCount !== 1 ? "s" : ""} to inventory`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
