import { useEffect, useRef, useState, useCallback } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Camera, X, Search } from "lucide-react";

interface BarcodeScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (barcode: string) => void;
}

export function BarcodeScanner({
  open,
  onOpenChange,
  onScan,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [manualBarcode, setManualBarcode] = useState("");
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const scannedRef = useRef(false); // prevent double-fire

  const stopCamera = useCallback(() => {
    if (controlsRef.current) {
      try { controlsRef.current.stop(); } catch { /* ignore */ }
      controlsRef.current = null;
    }
    readerRef.current = null;
    scannedRef.current = false;
    setScanning(false);
  }, []);

  const handleScan = useCallback((barcode: string) => {
    if (scannedRef.current) return;
    scannedRef.current = true;
    stopCamera();
    onScan(barcode);
    onOpenChange(false);
  }, [onScan, onOpenChange, stopCamera]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setCameraError(null);
      setManualBarcode("");
      return;
    }

    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;
    setScanning(true);

    const startScanning = async () => {
      try {
        if (!videoRef.current) return;
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result, err) => {
            if (result) {
              handleScan(result.getText());
            }
            if (err && err.name !== "NotFoundException") {
              console.error("Scanning error:", err);
            }
          }
        );
        controlsRef.current = controls;
      } catch (err) {
        console.error("Failed to start camera:", err);
        setCameraError("Camera unavailable — use manual entry below.");
        setScanning(false);
      }
    };

    void startScanning();

    return () => { stopCamera(); };
  }, [open, handleScan, stopCamera]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = manualBarcode.trim();
    if (!code) return;
    handleScan(code);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Scan Barcode
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Camera view */}
          {!cameraError ? (
            <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                autoPlay
                playsInline
                muted
              />
              {scanning && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="border-2 border-primary w-48 h-24 rounded opacity-60" />
                </div>
              )}
            </div>
          ) : (
            <div className="bg-muted text-muted-foreground p-4 rounded-md text-sm text-center">
              {cameraError}
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center">
            {scanning ? "Scanning — point camera at a barcode" : "Camera not available"}
          </p>

          {/* Manual entry fallback */}
          <div className="border-t pt-4">
            <form onSubmit={handleManualSubmit} className="space-y-2">
              <Label htmlFor="manual-barcode">Enter barcode manually</Label>
              <div className="flex gap-2">
                <Input
                  id="manual-barcode"
                  placeholder="e.g. 0038000845260"
                  value={manualBarcode}
                  onChange={(e) => setManualBarcode(e.target.value)}
                  inputMode="numeric"
                />
                <Button type="submit" size="icon" disabled={!manualBarcode.trim()}>
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </form>
          </div>

          <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
