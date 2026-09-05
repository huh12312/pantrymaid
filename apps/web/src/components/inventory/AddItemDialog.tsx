import { useState, useEffect, useRef } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DateInput } from "@/components/ui/DateInput";
import type { DateInputHandle } from "@/components/ui/DateInput";
import { Camera, ChevronDown, Search, Sparkles, X } from "lucide-react";
import { ProductImage } from "@/components/ui/ProductImage";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type InventoryItem, type CreateItemDto, type ProductSearchResult } from "@/lib/api";
import type { ScannedProduct } from "@/lib/barcodeLookup";
import type { ItemLocation } from "@pantrymaid/shared/schemas";
import { FOOD_CATEGORIES, COMMON_UNITS } from "@pantrymaid/shared/constants";
import type { ItemPreset } from "@pantrymaid/shared/constants";
import { QuickAddPresets } from "./QuickAddPresets";
import { queryKeys } from "@/lib/queryKeys";
import { addDays } from "@/lib/dates";

interface AddItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateItemDto) => void;
  editItem?: InventoryItem | null;
  defaultLocation?: ItemLocation;
  scannedProduct?: ScannedProduct | null;
  barcodeNotice?: string | null;
  isSubmitting?: boolean;
  onScanRequest?: () => void;
}

const emptyForm = (defaultLocation?: ItemLocation): CreateItemDto => ({
  name: "",
  quantity: 1,
  unit: "unit",
  location: defaultLocation ?? "pantry",
  opened: false,
  expirationEstimated: false,
});

export function AddItemDialog({
  open,
  onOpenChange,
  onSubmit,
  editItem,
  defaultLocation,
  scannedProduct,
  barcodeNotice,
  isSubmitting = false,
  onScanRequest,
}: AddItemDialogProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<CreateItemDto>(emptyForm(defaultLocation));
  const [duplicateWarning, setDuplicateWarning] = useState<InventoryItem | null>(null);
  const nameBlurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors DateInput's `meta.partial` for the expiry field: true while the
  // user has typed something that hasn't (yet) resolved to a valid date.
  // formData.expirationDate alone can't distinguish "genuinely empty" from
  // "mid-typing" — both are "". Only DateInput's onChange (user-driven) ever
  // writes this ref; programmatic writes (presets, AI suggestion, edit-item
  // load) never touch it, so it always reflects the user's actual typing state.
  const expiryPartialRef = useRef(false);
  // Imperative handle onto DateInput — see handleSubmit. Pressing Enter
  // inside a form triggers implicit submission WITHOUT blurring the focused
  // input, so short-form dates (4/6 digits) that only resolve on blur would
  // otherwise be silently dropped from the submitted payload.
  const dateInputRef = useRef<DateInputHandle>(null);

  // Product search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanButtonRef = useRef<HTMLButtonElement>(null);

  const { data: items = [] } = useQuery({
    queryKey: queryKeys.inventory.lists(),
    queryFn: () => api.getItems(),
    enabled: open,
  });

  // Computes an estimated-expiry patch for the preset, AI-suggestion, and
  // barcode-scan paths, sharing one guard: only overwrite the expiry when the
  // field is empty and not mid-typing, or when it currently holds a prior
  // system estimate. Otherwise the user's own typed/pasted date is preserved.
  const estimateDatePatch = (
    prev: CreateItemDto,
    days: number
  ): Partial<Pick<CreateItemDto, "expirationDate" | "expirationEstimated">> => {
    const isEmpty = !prev.expirationDate && !expiryPartialRef.current;
    const shouldOverwrite = isEmpty || prev.expirationEstimated === true;
    if (!shouldOverwrite) return {};
    return { expirationDate: addDays(days), expirationEstimated: true };
  };

  const suggestMutation = useMutation({
    mutationFn: (name: string) => api.suggestItemDefaults(name),
    onSuccess: (suggestion) => {
      // Manual/opt-in only (fired from the Quick Add "AI suggest" button) — scanning
      // never triggers this, so there's no redundant second LLM call. If the user
      // explicitly asks for a name-based suggestion after a barcode scan already set
      // an estimate, this is a deliberate later action and, per estimateDatePatch's
      // existing rule, is allowed to replace the prior estimate — same precedence
      // preset selection already has over a previous AI suggestion.
      setFormData((prev) => ({
        ...prev,
        unit: suggestion.unit,
        category: suggestion.category,
        ...(suggestion.estimatedShelfDays
          ? estimateDatePatch(prev, suggestion.estimatedShelfDays)
          : {}),
      }));
    },
  });

  // Debounced product search
  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    setActiveIndex(-1);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (q.trim().length < 2) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await api.searchProducts(q.trim());
        setSearchResults(results);
        setShowResults(results.length > 0);
        setActiveIndex(-1);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  };

  const handleSelectResult = (result: ProductSearchResult) => {
    setFormData((prev) => ({
      ...prev,
      name: result.name ?? prev.name,
      brand: result.brand ?? prev.brand,
      category: result.category ?? prev.category,
      imageUrl: result.imageUrl ?? prev.imageUrl,
      barcodeUpc: result.upc ?? prev.barcodeUpc,
    }));
    setSearchQuery("");
    setShowResults(false);
    setSearchResults([]);
    setActiveIndex(-1);
  };

  const SOURCE_LABEL: Record<string, string> = {
    kroger: "Kroger",
    open_food_facts: "Open Food Facts",
    trader_joes: "Trader Joe's",
    manual: "Manual",
  };

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setSearchResults([]);
      setShowResults(false);
    }
  }, [open]);

  useEffect(() => {
    if (open && scannedProduct?.barcode) scanButtonRef.current?.focus();
  }, [open, scannedProduct]);

  useEffect(() => {
    if (!open) return;
    // The dialog is being (re)populated for a new subject (edit item,
    // scanned product, or a fresh blank form) — any in-progress typing state
    // from a previous open no longer applies.
    expiryPartialRef.current = false;
    if (editItem) {
      setFormData({
        name: editItem.name,
        brand: editItem.brand ?? undefined,
        quantity: editItem.quantity,
        unit: editItem.unit ?? "unit",
        location: editItem.location,
        category: editItem.category ?? undefined,
        expirationDate: editItem.expirationDate ?? undefined,
        expirationEstimated: editItem.expirationEstimated,
        barcodeUpc: editItem.barcodeUpc ?? undefined,
        imageUrl: editItem.imageUrl ?? undefined,
        notes: editItem.notes ?? undefined,
        opened: editItem.opened ?? false,
      });
    } else if (scannedProduct) {
      setFormData((prev) => {
        const base: CreateItemDto = {
          name: scannedProduct.name,
          brand: scannedProduct.brand,
          quantity: 1,
          unit: "unit",
          location: defaultLocation ?? "pantry",
          category: scannedProduct.category,
          imageUrl: scannedProduct.imageUrl,
          barcodeUpc: scannedProduct.barcode,
          opened: false,
          // Default to whatever the field already held — not a blank
          // template — so a date the user already typed (e.g. before
          // re-scanning via the in-dialog scan button, which updates
          // `scannedProduct` without the dialog ever closing) isn't dropped
          // when the guard below decides NOT to overwrite it.
          expirationDate: prev.expirationDate,
          expirationEstimated: prev.expirationEstimated ?? false,
        };
        // Apply the barcode-derived estimate through the SAME guard used by
        // presets and AI suggestions, rather than a second date-derivation path.
        // Among the three estimate sources it's the strongest signal (keyed on
        // the actual matched product, not just a name), so it's applied eagerly
        // here rather than waiting for user action. A later rescan's estimate
        // still overwrites a PRIOR estimate, same as a second preset does.
        // `estimatedExpirationDays` is optional and omitted on estimation
        // failure, so a response missing it is a no-op (datePatch stays `{}`,
        // leaving the `base` defaults above untouched).
        const datePatch =
          scannedProduct.estimatedExpirationDays != null
            ? estimateDatePatch(prev, scannedProduct.estimatedExpirationDays)
            : {};
        return { ...base, ...datePatch };
      });
    } else {
      setFormData(emptyForm(defaultLocation));
    }
    setDuplicateWarning(null);
  }, [editItem, scannedProduct, open, defaultLocation]);

  // Only true while formData's expiry date/estimated-flag still match exactly
  // what the CURRENT scannedProduct's estimate would produce — i.e. nothing
  // (user edit, a preset, a fresh AI suggestion) has overwritten it since. Pure
  // derived comparison, not a second source of truth: `addDays` is the same
  // helper estimateDatePatch itself calls, used here only to know what to
  // compare against, never to decide whether to write it.
  const scanEstimateDate =
    scannedProduct?.estimatedExpirationDays != null
      ? addDays(scannedProduct.estimatedExpirationDays)
      : null;
  const showScanEstimateHint =
    !!scanEstimateDate &&
    !!scannedProduct?.estimatedExpirationLabel &&
    formData.expirationEstimated === true &&
    formData.expirationDate === scanEstimateDate;

  const handleNameBlur = () => {
    if (editItem || !formData.name.trim()) return;
    if (nameBlurTimeout.current) clearTimeout(nameBlurTimeout.current);
    nameBlurTimeout.current = setTimeout(() => {
      const match = items.find((i) => i.name.toLowerCase() === formData.name.trim().toLowerCase());
      setDuplicateWarning(match ?? null);
    }, 200);
  };

  const handleMerge = () => {
    if (!duplicateWarning) return;
    void api
      .updateItem(duplicateWarning.id, {
        quantity: duplicateWarning.quantity + (formData.quantity || 1),
      })
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.lists() });
        setDuplicateWarning(null);
        onOpenChange(false);
      });
  };

  const handlePresetSelect = (preset: ItemPreset) => {
    setFormData((prev) => ({
      ...prev,
      name: preset.name,
      category: preset.category,
      unit: preset.unit,
      ...estimateDatePatch(prev, preset.estimatedShelfDays),
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Force-resolve any pending short-form date (4/6 digits) before reading
    // it. Pressing Enter submits the form without blurring the focused
    // input, so DateInput's keystroke path never got a chance to resolve —
    // formData.expirationDate would still be "" here even though the user
    // typed something valid. Use the RETURNED value, not formData: the
    // onChange resolvePending() fires internally is a state update and is
    // not visible in formData until the next render, after this function
    // has already run.
    const pending = dateInputRef.current
      ? dateInputRef.current.resolvePending()
      : (formData.expirationDate ?? "");
    if (pending === null) {
      // Unresolvable text is present — DateInput is now showing "Enter a
      // complete date". Block the submit rather than silently discarding or
      // wiping what the user typed.
      dateInputRef.current?.focus();
      return;
    }
    // Coerce an empty expirationDate: on the create path to undefined (so the
    // server's z.coerce.date() never receives "" and produces an Invalid Date
    // / 400), on the edit path to null so an existing expiry can actually be
    // cleared — undefined is dropped from the JSON body entirely and Drizzle
    // skips undefined columns on .set(), silently no-opping the clear.
    const payload: CreateItemDto = {
      ...formData,
      expirationDate: pending ? pending : editItem ? null : undefined,
    };
    onSubmit(payload);
    // Parent closes the dialog on success (or keeps it open on error)
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showHandle className="flex flex-col">
        <SheetHeader className="shrink-0">
          <SheetTitle>{editItem ? "Edit Item" : "Add New Item"}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto pb-2">
            {barcodeNotice && (
              <div
                role="status"
                aria-live="polite"
                className="mb-4 rounded-md bg-warning/10 border border-warning/30 px-4 py-3 text-sm text-warning"
              >
                {barcodeNotice}
              </div>
            )}

            {!editItem && (
              <Collapsible className="mb-4">
                <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary">
                  <span className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                    Quick add a common item
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <QuickAddPresets
                    onSelect={handlePresetSelect}
                    onAISuggest={(name) => suggestMutation.mutate(name)}
                    isSuggestLoading={suggestMutation.isPending}
                  />
                </CollapsibleContent>
              </Collapsible>
            )}

            {!editItem && (
              <div className="mb-4">
                <Label htmlFor="product-search">Search products</Label>
                <div className="mt-1 flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      id="product-search"
                      role="combobox"
                      aria-expanded={showResults && searchResults.length > 0}
                      aria-controls="product-search-listbox"
                      aria-autocomplete="list"
                      aria-activedescendant={
                        activeIndex >= 0 && showResults
                          ? `product-option-${activeIndex}`
                          : undefined
                      }
                      value={searchQuery}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      onBlur={() =>
                        setTimeout(() => {
                          setShowResults(false);
                          setActiveIndex(-1);
                        }, 150)
                      }
                      onKeyDown={(e) => {
                        // Always intercept Enter and Escape on this input to prevent
                        // accidental form submission when the listbox is open or closed.
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (
                            showResults &&
                            activeIndex >= 0 &&
                            activeIndex < searchResults.length
                          ) {
                            handleSelectResult(searchResults[activeIndex]!);
                          }
                          return;
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setShowResults(false);
                          setActiveIndex(-1);
                          return;
                        }
                        if (!showResults || searchResults.length === 0) return;
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setActiveIndex((prev) => Math.min(prev + 1, searchResults.length - 1));
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setActiveIndex((prev) => Math.max(prev - 1, 0));
                        }
                      }}
                      placeholder="Search Kroger, Open Food Facts…"
                      className="pl-9 pr-9 h-11 sm:h-10"
                      autoComplete="off"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        aria-label="Clear search"
                        onClick={() => {
                          setSearchQuery("");
                          setShowResults(false);
                          setSearchResults([]);
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                    {isSearching && (
                      <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
                        Searching…
                      </p>
                    )}
                    {showResults && searchResults.length > 0 && (
                      <ul
                        id="product-search-listbox"
                        role="listbox"
                        aria-label="Product search results"
                        className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-60 overflow-y-auto"
                      >
                        {searchResults.map((r, i) => (
                          <li
                            key={`${r.source}-${r.upc ?? r.name}-${i}`}
                            id={`product-option-${i}`}
                            role="option"
                            aria-selected={activeIndex === i}
                            tabIndex={-1}
                            onClick={() => handleSelectResult(r)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSelectResult(r);
                            }}
                            onMouseDown={(e) => e.preventDefault()}
                            className={[
                              "flex w-full items-center gap-3 px-3 py-2 text-left text-sm cursor-pointer transition-colors",
                              activeIndex === i ? "bg-accent" : "hover:bg-accent",
                            ].join(" ")}
                          >
                            <ProductImage
                              src={r.imageUrl}
                              alt=""
                              className="h-10 w-10 flex-shrink-0 rounded"
                              iconClassName="text-muted-foreground/40"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{r.name}</p>
                              {r.brand && (
                                <p className="text-xs text-muted-foreground truncate">{r.brand}</p>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                              {SOURCE_LABEL[r.source] ?? r.source}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {onScanRequest && (
                    <Button
                      ref={scanButtonRef}
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-11 w-11 sm:h-10 sm:w-10 shrink-0"
                      aria-label="Scan barcode"
                      onClick={onScanRequest}
                    >
                      <Camera className="h-5 w-5" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => {
                    setFormData({ ...formData, name: e.target.value });
                    setDuplicateWarning(null);
                  }}
                  onBlur={handleNameBlur}
                  required
                />
                {duplicateWarning && (
                  <div className="mt-2 rounded-md bg-warning/10 border border-warning/30 px-3 py-2 text-xs text-warning">
                    You already have <strong>{duplicateWarning.name}</strong> in your{" "}
                    <strong>{duplicateWarning.location}</strong> (qty: {duplicateWarning.quantity}).
                    <div className="flex gap-2 mt-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs"
                        onClick={() => setDuplicateWarning(null)}
                      >
                        Add Anyway
                      </Button>
                      <Button type="button" size="sm" className="h-6 text-xs" onClick={handleMerge}>
                        Merge Qty
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <Label htmlFor="brand">Brand</Label>
                <Input
                  id="brand"
                  value={formData.brand || ""}
                  onChange={(e) => setFormData({ ...formData, brand: e.target.value || undefined })}
                  placeholder="e.g. Pringles"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="quantity">Quantity *</Label>
                  <Input
                    id="quantity"
                    type="number"
                    min="0"
                    step="0.1"
                    value={formData.quantity}
                    onChange={(e) =>
                      setFormData({ ...formData, quantity: parseFloat(e.target.value) })
                    }
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="unit">Unit</Label>
                  <Select
                    value={formData.unit ?? "unit"}
                    onValueChange={(value) => setFormData({ ...formData, unit: value })}
                  >
                    <SelectTrigger id="unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMMON_UNITS.map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="location">Location *</Label>
                <Select
                  value={formData.location}
                  onValueChange={(value: ItemLocation) =>
                    setFormData({ ...formData, location: value })
                  }
                >
                  <SelectTrigger id="location">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pantry">Pantry</SelectItem>
                    <SelectItem value="fridge">Fridge</SelectItem>
                    <SelectItem value="freezer">Freezer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="category">Category</Label>
                <Select
                  value={formData.category || ""}
                  onValueChange={(value) =>
                    setFormData({ ...formData, category: value || undefined })
                  }
                >
                  <SelectTrigger id="category">
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {FOOD_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="expirationDate">Expiry Date</Label>
                <DateInput
                  ref={dateInputRef}
                  id="expirationDate"
                  value={formData.expirationDate || ""}
                  aria-describedby={showScanEstimateHint ? "scan-estimate-hint" : undefined}
                  onChange={(value, meta) => {
                    expiryPartialRef.current = meta.partial;
                    setFormData((prev) => ({
                      ...prev,
                      expirationDate: value,
                      // Any user-driven edit (typing, clearing) supersedes a
                      // prior system estimate — it's no longer an estimate.
                      // (This also naturally stops showScanEstimateHint from
                      // matching, since the date and/or flag now differ from
                      // the scan's estimate.)
                      expirationEstimated: false,
                    }));
                  }}
                />
                {showScanEstimateHint && (
                  <p id="scan-estimate-hint" className="mt-1 text-xs text-muted-foreground">
                    Estimated {scannedProduct?.estimatedExpirationLabel} based on the scanned
                    product
                  </p>
                )}
              </div>

              {editItem && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="opened"
                    checked={formData.opened ?? false}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, opened: checked === true })
                    }
                  />
                  <Label htmlFor="opened" className="font-normal cursor-pointer">
                    Mark as opened
                  </Label>
                </div>
              )}

              <div>
                <Label htmlFor="imageUrl">Image URL</Label>
                {formData.imageUrl && (
                  <ProductImage
                    src={formData.imageUrl}
                    alt={formData.name}
                    className="mt-1.5 mb-2 h-40 w-full rounded-lg"
                    iconClassName="h-8 w-8 text-muted-foreground/30"
                  />
                )}
                <Input
                  id="imageUrl"
                  type="url"
                  value={formData.imageUrl || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, imageUrl: e.target.value || undefined })
                  }
                  placeholder="https://example.com/image.jpg"
                />
              </div>

              <div>
                <Label htmlFor="notes">Notes</Label>
                <Input
                  id="notes"
                  value={formData.notes || ""}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>
            </div>
          </div>
          <SheetFooter className="shrink-0 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              className="h-11 sm:h-10"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" className="h-11 sm:h-10" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : editItem ? "Update Item" : "Add Item"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
