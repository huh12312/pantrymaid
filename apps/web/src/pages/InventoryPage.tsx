import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Camera, FileText, LogOut } from "lucide-react";
import { ItemList } from "@/components/inventory/ItemList";
import { AddItemDialog } from "@/components/inventory/AddItemDialog";
import { BarcodeScanner } from "@/components/inventory/BarcodeScanner";
import { ReceiptUpload } from "@/components/inventory/ReceiptUpload";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { api, type InventoryItem, type CreateItemDto } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { useAuth } from "@/lib/auth";
import { useNavigate } from "react-router-dom";

type LocationType = "pantry" | "fridge" | "freezer";

export default function InventoryPage() {
  const navigate = useNavigate();
  const { clearAuth, user } = useAuth();
  const queryClient = useQueryClient();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [receiptUploadOpen, setReceiptUploadOpen] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [defaultLocation, setDefaultLocation] = useState<LocationType | undefined>();
  const [scannedProduct, setScannedProduct] = useState<{ name: string; brand?: string; category?: string; imageUrl?: string; barcode: string } | null>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: queryKeys.inventory.list(),
    queryFn: () => api.getItems(),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateItemDto) => api.createItem(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.lists() });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CreateItemDto }) =>
      api.updateItem(id, data),
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

  const handleAddItem = (location?: LocationType) => {
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
  };

  const handleBarcodeScan = (barcode: string) => {
    void (async () => {
      try {
        const result = await api.lookupBarcode(barcode);
        // Use null editItem so the dialog routes to createMutation, not updateMutation.
        // Pre-fill via defaultLocation + open dialog; pass scanned data as default values.
        setEditItem(null);
        setDefaultLocation("pantry");
        setScannerOpen(false);
        // Store scanned product for AddItemDialog to use as initial values
        setScannedProduct({
          name: result.name,
          brand: result.brand,
          category: result.category,
          imageUrl: result.imageUrl,
          barcode,
        });
        setAddDialogOpen(true);
      } catch (error) {
        console.error("Barcode lookup failed:", error);
      }
    })();
  };

  const handleLogout = () => {
    clearAuth();
    navigate("/login");
  };

  const pantryItems = items.filter((item) => item.location === "pantry");
  const fridgeItems = items.filter((item) => item.location === "fridge");
  const freezerItems = items.filter((item) => item.location === "freezer");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">PantryMaid</h1>
              {user && (
                <p className="text-sm text-muted-foreground">
                  Welcome, {user.name}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => setScannerOpen(true)} variant="outline" size="sm">
                <Camera className="h-4 w-4 mr-2" />
                Scan
              </Button>
              <Button onClick={() => setReceiptUploadOpen(true)} variant="outline" size="sm">
                <FileText className="h-4 w-4 mr-2" />
                Receipt
              </Button>
              <ThemeToggle />
              <Button onClick={handleLogout} variant="ghost" size="sm">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Pantry</CardTitle>
                  <Button
                    size="sm"
                    onClick={() => handleAddItem("pantry")}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ItemList
                  items={pantryItems}
                  onEdit={handleEditItem}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Fridge</CardTitle>
                  <Button
                    size="sm"
                    onClick={() => handleAddItem("fridge")}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ItemList
                  items={fridgeItems}
                  onEdit={handleEditItem}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Freezer</CardTitle>
                  <Button
                    size="sm"
                    onClick={() => handleAddItem("freezer")}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ItemList
                  items={freezerItems}
                  onEdit={handleEditItem}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      <AddItemDialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          setAddDialogOpen(open);
          if (!open) setScannedProduct(null);
        }}
        onSubmit={handleSubmit}
        editItem={editItem}
        defaultLocation={defaultLocation}
        scannedProduct={scannedProduct}
      />

      <BarcodeScanner
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onScan={handleBarcodeScan}
      />

      <ReceiptUpload
        open={receiptUploadOpen}
        onOpenChange={setReceiptUploadOpen}
        onUpload={(file) => { uploadReceiptMutation.mutate(file); }}
      />
    </div>
  );
}
