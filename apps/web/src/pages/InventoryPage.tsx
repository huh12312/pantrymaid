import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Camera,
  FileText,
  Package,
  Thermometer,
  Snowflake,
  AlertTriangle,
  Search,
} from "lucide-react";
import { ItemList } from "@/components/inventory/ItemList";
import { AddItemDialog } from "@/components/inventory/AddItemDialog";
import { BarcodeScanner } from "@/components/inventory/BarcodeScanner";
import { ReceiptUpload } from "@/components/inventory/ReceiptUpload";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Sidebar } from "@/components/layout/Sidebar";
import { api, type InventoryItem, type CreateItemDto } from "@/lib/api";
import type { ItemLocation } from "@pantrymaid/shared/schemas";
import { queryKeys } from "@/lib/queryKeys";
import { useAuth } from "@/lib/auth";
import { useNavigate } from "react-router-dom";

const colorMap = {
  violet: "bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400",
  blue: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
  cyan: "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400",
  amber: "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400",
};

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  sub: string;
  color: "violet" | "blue" | "cyan" | "amber";
}) {

  return (
    <div className="bg-card rounded-2xl border p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <div className={`p-2 rounded-xl ${colorMap[color]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="text-3xl font-bold tracking-tight">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}

function LocationSection({
  title,
  icon: Icon,
  items,
  color,
  onAdd,
  onEdit,
  onDelete,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: InventoryItem[];
  color: "violet" | "blue" | "cyan";
  onAdd: () => void;
  onEdit: (item: InventoryItem) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div data-testid={`section-${title.toLowerCase()}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className={`p-2 rounded-xl ${colorMap[color]}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">{title}</h3>
            <p className="text-xs text-muted-foreground">
              {items.length} item{items.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <Button size="icon" variant="ghost" className="h-8 w-8 rounded-xl" onClick={onAdd}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <ItemList items={items} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

export default function InventoryPage() {
  const navigate = useNavigate();
  const { clearAuth, user } = useAuth();
  const queryClient = useQueryClient();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [receiptUploadOpen, setReceiptUploadOpen] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [defaultLocation, setDefaultLocation] = useState<ItemLocation | undefined>();
  const [scannedProduct, setScannedProduct] = useState<{
    name: string;
    brand?: string;
    category?: string;
    imageUrl?: string;
    barcode: string;
  } | null>(null);
  const [barcodeNotice, setBarcodeNotice] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"all" | "pantry" | "fridge" | "freezer">(
    "all",
  );
  const [searchQuery, setSearchQuery] = useState("");

  const { data: items = [], isLoading } = useQuery({
    queryKey: queryKeys.inventory.list(),
    queryFn: () => api.getItems(),
  });

  const { data: household } = useQuery({
    queryKey: queryKeys.household.details(),
    queryFn: () => api.getHousehold(),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateItemDto) => api.createItem(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.lists() });
      // Second invalidation gives the async image resolver time to patch the DB
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.lists() });
      }, 3000);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CreateItemDto }) => api.updateItem(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.lists() });
      setEditItem(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteItem(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.lists() });
    },
  });

  const uploadReceiptMutation = useMutation({
    mutationFn: (file: File) => api.uploadReceipt(file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.lists() });
    },
  });

  const handleAddItem = (location?: ItemLocation) => {
    setDefaultLocation(location);
    setEditItem(null);
    setAddDialogOpen(true);
  };

  const handleEditItem = (item: InventoryItem) => {
    setEditItem(item);
    setDefaultLocation(undefined);
    setAddDialogOpen(true);
  };

  const handleSubmit = (data: CreateItemDto) => {
    if (editItem) {
      updateMutation.mutate({ id: editItem.id, data });
    } else {
      createMutation.mutate(data);
    }
    setScannedProduct(null);
    setBarcodeNotice(null);
  };

  const handleBarcodeScan = (barcode: string) => {
    void (async () => {
      setEditItem(null);
      setDefaultLocation("pantry");
      setScannerOpen(false);

      try {
        const product = await api.lookupBarcode(barcode);
        setBarcodeNotice(null);
        setScannedProduct({
          name: product.name,
          brand: product.brand,
          category: product.category,
          imageUrl: product.imageUrl,
          barcode,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        const isNotFound = message.includes("404");
        setBarcodeNotice(
          isNotFound
            ? "We couldn't find that product in our database. No worries — just fill in the details below!"
            : "Something went wrong looking up that barcode. You can still add the item manually.",
        );
        setScannedProduct({ name: "", barcode });
      }

      setAddDialogOpen(true);
    })();
  };

  const handleLogout = () => {
    clearAuth();
    navigate("/login");
  };

  const pantryItems = items.filter((item) => item.location === "pantry");
  const fridgeItems = items.filter((item) => item.location === "fridge");
  const freezerItems = items.filter((item) => item.location === "freezer");

  const expiringCount = items.filter((item) => {
    if (!item.expirationDate) return false;
    const d = new Date(item.expirationDate);
    return d > new Date() && d <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }).length;

  const expiredCount = items.filter((item) =>
    item.expirationDate ? new Date(item.expirationDate) < new Date() : false,
  ).length;

  const filterItems = (itemsToFilter: InventoryItem[]) => {
    if (!searchQuery.trim()) return itemsToFilter;
    const q = searchQuery.toLowerCase();
    return itemsToFilter.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.brand?.toLowerCase().includes(q) ||
        item.category?.toLowerCase().includes(q),
    );
  };

  const filteredPantry = filterItems(pantryItems);
  const filteredFridge = filterItems(fridgeItems);
  const filteredFreezer = filterItems(freezerItems);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        user={user}
        onLogout={handleLogout}
        totalItems={items.length}
        expiringCount={expiringCount}
        expiredCount={expiredCount}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        pantryCount={pantryItems.length}
        fridgeCount={fridgeItems.length}
        freezerCount={freezerItems.length}
        inviteCode={household?.inviteCode}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="shrink-0 border-b bg-card px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">
              {activeSection === "all"
                ? "All Storage"
                : activeSection === "pantry"
                  ? "Pantry"
                  : activeSection === "fridge"
                    ? "Fridge"
                    : "Freezer"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {user ? `Welcome back, ${user.name}` : "Your household inventory"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative hidden sm:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 text-sm bg-secondary rounded-xl border-0 w-56 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground"
              />
            </div>
            <Button
              onClick={() => setScannerOpen(true)}
              variant="outline"
              size="sm"
              className="rounded-xl"
            >
              <Camera className="h-4 w-4 mr-2" />
              Scan
            </Button>
            <Button
              onClick={() => setReceiptUploadOpen(true)}
              variant="outline"
              size="sm"
              className="rounded-xl"
            >
              <FileText className="h-4 w-4 mr-2" />
              Receipt
            </Button>
            <ThemeToggle />
          </div>
        </header>

        {/* Scrollable main content */}
        <main className="flex-1 overflow-y-auto p-6">
          {/* Stats row — only in "all" view */}
          {activeSection === "all" && (
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
              <StatCard
                icon={Package}
                label="Total Items"
                value={items.length}
                sub="in your kitchen"
                color="violet"
              />
              <StatCard
                icon={Thermometer}
                label="In Fridge"
                value={fridgeItems.length}
                sub="items refrigerated"
                color="blue"
              />
              <StatCard
                icon={Snowflake}
                label="In Freezer"
                value={freezerItems.length}
                sub="items frozen"
                color="cyan"
              />
              <StatCard
                icon={AlertTriangle}
                label="Expiring Soon"
                value={expiringCount}
                sub="within 7 days"
                color="amber"
              />
            </div>
          )}

          {/* Item sections */}
          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <div className="text-center">
                <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Loading your inventory...</p>
              </div>
            </div>
          ) : (
            <div
              className={activeSection === "all" ? "grid grid-cols-1 md:grid-cols-3 gap-6" : "max-w-lg"}
            >
              {(activeSection === "all" || activeSection === "pantry") && (
                <LocationSection
                  title="Pantry"
                  icon={Package}
                  items={filteredPantry}
                  color="violet"
                  onAdd={() => handleAddItem("pantry")}
                  onEdit={handleEditItem}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              )}
              {(activeSection === "all" || activeSection === "fridge") && (
                <LocationSection
                  title="Fridge"
                  icon={Thermometer}
                  items={filteredFridge}
                  color="blue"
                  onAdd={() => handleAddItem("fridge")}
                  onEdit={handleEditItem}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              )}
              {(activeSection === "all" || activeSection === "freezer") && (
                <LocationSection
                  title="Freezer"
                  icon={Snowflake}
                  items={filteredFreezer}
                  color="cyan"
                  onAdd={() => handleAddItem("freezer")}
                  onEdit={handleEditItem}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              )}
            </div>
          )}
        </main>
      </div>

      <AddItemDialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          setAddDialogOpen(open);
          if (!open) {
            setScannedProduct(null);
            setBarcodeNotice(null);
          }
        }}
        onSubmit={handleSubmit}
        editItem={editItem}
        defaultLocation={defaultLocation}
        scannedProduct={scannedProduct}
        barcodeNotice={barcodeNotice}
      />

      <BarcodeScanner
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onScan={handleBarcodeScan}
      />

      <ReceiptUpload
        open={receiptUploadOpen}
        onOpenChange={setReceiptUploadOpen}
        onUpload={(file) => {
          uploadReceiptMutation.mutate(file);
        }}
      />
    </div>
  );
}
