import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Camera, X } from "lucide-react";

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
  const [error, setError] = useState<string | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    if (!open) {
      if (controlsRef.current) {
        try {
          controlsRef.current.stop();
        } catch {
          // Ignore stop errors
        }
        controlsRef.current = null;
      }
      readerRef.current = null;
      return;
    }

    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    const startScanning = async () => {
      try {
        if (!videoRef.current) return;

        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result, err) => {
            if (result) {
              const barcode = result.getText();
              onScan(barcode);
              onOpenChange(false);
            }
            if (err && err.name !== "NotFoundException") {
              console.error("Scanning error:", err);
            }
          }
        );
        controlsRef.current = controls;
      } catch (err) {
        console.error("Failed to start camera:", err);
        setError("Failed to access camera. Please check permissions.");
      }
    };

    void startScanning();

    return () => {
      if (controlsRef.current) {
        try {
          controlsRef.current.stop();
        } catch {
          // Ignore stop errors
        }
      }
    };
  }, [open, onScan, onOpenChange]);

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
          {error ? (
            <div className="bg-destructive/10 text-destructive p-4 rounded-md">
              {error}
            </div>
          ) : (
            <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                autoPlay
                playsInline
              />
            </div>
          )}
          <p className="text-sm text-muted-foreground text-center">
            Position the barcode within the camera view
          </p>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
