import { useEffect, useRef, useState, useCallback } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Camera, X, Search, Zap, ZapOff } from "lucide-react";
import { acquireCameraStream } from "@/lib/barcodeCamera";
import { resolveScanEngine, type ScanEngineControls } from "@/lib/scanEngine";

// Extended camera constraint types (torch/zoom not in TypeScript stdlib)
interface ExtendedTrackCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
  zoom?: { min: number; max: number; step: number };
  focusMode?: string[];
}

const ZOOM_LEVELS = [
  { label: "1×", factor: 1 as const },
  { label: "2×", factor: 2 as const },
  { label: "3×", factor: 3 as const },
];

interface BarcodeScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (barcode: string) => void;
}

export function BarcodeScanner({ open, onOpenChange, onScan }: BarcodeScannerProps) {
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const videoCallbackRef = useCallback((el: HTMLVideoElement | null) => {
    setVideoEl(el);
  }, []);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [manualBarcode, setManualBarcode] = useState("");

  // Manual entry starts collapsed so opening the scanner shows the camera
  // view without popping the on-screen keyboard. It reveals automatically
  // (but is never auto-focused) when the camera is unavailable, since that's
  // the only way to proceed in that case.
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Set right before revealing manual entry via the user-initiated control so
  // the focus effect below only fires focus for that path, not the
  // camera-error auto-reveal.
  const focusManualOnRevealRef = useRef(false);

  // Camera controls — only shown when the device supports them
  const [hasTorch, setHasTorch] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [hasZoom, setHasZoom] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<1 | 2 | 3>(1);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number } | null>(null);

  const controlsRef = useRef<ScanEngineControls | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const scannedRef = useRef(false);

  const stopCamera = useCallback(() => {
    if (controlsRef.current) {
      try {
        controlsRef.current.stop();
      } catch {
        /* ignore */
      }
      controlsRef.current = null;
    }
    trackRef.current = null;
    scannedRef.current = false;
    setScanning(false);
    setHasTorch(false);
    setHasZoom(false);
    setTorchEnabled(false);
    setZoomLevel(1);
    setZoomRange(null);
  }, []);

  const handleScan = useCallback(
    (barcode: string) => {
      if (scannedRef.current) return;
      scannedRef.current = true;
      stopCamera();
      onScan(barcode);
      onOpenChange(false);
    },
    [onScan, onOpenChange, stopCamera]
  );

  useEffect(() => {
    if (!open) {
      stopCamera();
      setCameraError(null);
      setManualBarcode("");
      setManualEntryOpen(false);
    }
  }, [open, stopCamera]);

  // Camera unavailable/errored → manual entry is the only way to proceed, so
  // reveal it automatically. Do NOT focus it: a surprise keyboard is exactly
  // the complaint this fix addresses.
  useEffect(() => {
    if (cameraError) {
      setManualEntryOpen(true);
    }
  }, [cameraError]);

  // Focus the manual-entry input only when the user explicitly asked for it
  // via the reveal control (see focusManualOnRevealRef above) — not when it
  // was auto-revealed by a camera error.
  useEffect(() => {
    if (manualEntryOpen && focusManualOnRevealRef.current) {
      focusManualOnRevealRef.current = false;
      manualInputRef.current?.focus();
    }
  }, [manualEntryOpen]);

  const handleRevealManualEntry = () => {
    focusManualOnRevealRef.current = true;
    setManualEntryOpen(true);
  };

  useEffect(() => {
    if (!open || !videoEl) return;

    let cancelled = false;
    setScanning(true);

    const startScanning = async () => {
      try {
        // Acquire the stream ourselves (rather than letting ZXing's
        // decodeFromVideoDevice pick its own constraints) so we can request a
        // real resolution hint and, where confidently identifiable, the main
        // rear color camera rather than an ultra-wide/telephoto/depth sensor.
        // See lib/barcodeCamera.ts for the constraint/selection heuristics.
        const stream = await acquireCameraStream({ mediaDevices: navigator.mediaDevices });
        if (cancelled) {
          stream.getVideoTracks().forEach((t) => t.stop());
          return;
        }

        // Prefer the native, hardware-accelerated BarcodeDetector when this
        // browser has one that supports our grocery symbologies; ZXing is
        // the fallback (and the only path in Firefox/Safari/jsdom).
        const engine = await resolveScanEngine({
          win: typeof window !== "undefined" ? window : undefined,
          createZXingReader: () => new BrowserMultiFormatReader(),
        });
        if (cancelled) {
          stream.getVideoTracks().forEach((t) => t.stop());
          return;
        }

        const controls = await engine.start(stream, videoEl, handleScan, (err) => {
          console.error("Scanning error:", err);
        });
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;

        // Detect torch / zoom support, and log the negotiated resolution for
        // dev-visible diagnosis (devtools console + a data attribute), now
        // that we hold a direct reference to the stream we opened.
        const track = stream.getVideoTracks()[0];
        if (track) {
          trackRef.current = track;

          const settings = track.getSettings();
          console.info(
            `[BarcodeScanner] negotiated camera stream: ${settings.width ?? "?"}x${settings.height ?? "?"}` +
              ` deviceId=${settings.deviceId ?? "unknown"} label="${track.label || "unlabeled"}"`
          );
          videoEl.dataset.negotiatedResolution = `${settings.width ?? "?"}x${settings.height ?? "?"}`;

          const caps = track.getCapabilities() as ExtendedTrackCapabilities;
          setHasTorch(caps.torch === true);
          if (caps.zoom) {
            setHasZoom(true);
            setZoomRange({ min: caps.zoom.min, max: caps.zoom.max });
          }
          // Keep the camera continuously refocusing for devices whose driver
          // default isn't already continuous (most are, so this is a no-op there).
          if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
            try {
              await track.applyConstraints({
                advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
              });
            } catch {
              // Non-fatal — camera keeps its driver default
            }
          }
        }
      } catch (err) {
        console.error("Failed to start camera:", err);
        setCameraError("Camera unavailable — use manual entry below.");
        setScanning(false);
      }
    };

    void startScanning();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, videoEl, handleScan, stopCamera]);

  const handleTorchToggle = async () => {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchEnabled;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchEnabled(next);
    } catch {
      // Torch not supported on this device
    }
  };

  const handleZoom = async (factor: 1 | 2 | 3) => {
    const track = trackRef.current;
    if (!track || !zoomRange) return;
    const { min, max } = zoomRange;
    const range = max - min;
    const value =
      factor === 1 ? min : factor === 2 ? min + range * 0.3 : Math.min(min + range * 0.6, max);
    try {
      await track.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] });
      setZoomLevel(factor);
    } catch {
      // Zoom not supported on this device
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = manualBarcode.trim();
    if (!code) return;
    handleScan(code);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showHandle
        onOpenAutoFocus={(e) => {
          // Radix auto-focuses the first tabbable element on open, which is
          // the manual-entry input — popping the keyboard over the camera.
          // Prevent that default, then move focus to the (non-input) heading
          // instead so the dialog is still announced to screen readers and
          // focus stays trapped inside the sheet.
          e.preventDefault();
          titleRef.current?.focus();
        }}
      >
        <SheetHeader>
          <SheetTitle ref={titleRef} tabIndex={-1} className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Scan Barcode
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4">
          {/* Camera view */}
          {!cameraError ? (
            <div className="relative bg-black rounded-lg overflow-hidden aspect-[3/4] max-h-[50dvh] md:max-h-none md:aspect-video select-none">
              <video
                ref={videoCallbackRef}
                className="w-full h-full object-cover"
                autoPlay
                playsInline
                muted
              />

              {/* Scan window */}
              {scanning && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="border-2 border-white w-64 h-28 rounded opacity-80" />
                </div>
              )}

              {/* Torch button — only on supporting devices */}
              {hasTorch && scanning && (
                <button
                  type="button"
                  onClick={() => void handleTorchToggle()}
                  className="absolute top-3 right-3 bg-black/50 p-2 rounded-full"
                  aria-label={torchEnabled ? "Turn off torch" : "Turn on torch"}
                >
                  {torchEnabled ? (
                    <Zap className="h-5 w-5 text-yellow-300 fill-yellow-300" />
                  ) : (
                    <ZapOff className="h-5 w-5 text-white" />
                  )}
                </button>
              )}

              {/* Zoom buttons — only on supporting devices */}
              {scanning && hasZoom && (
                <div className="absolute bottom-3 left-0 right-0 flex items-center justify-center">
                  <div className="flex gap-1.5">
                    {ZOOM_LEVELS.map(({ label, factor }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => void handleZoom(factor)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                          zoomLevel === factor
                            ? "bg-white text-black border-white"
                            : "bg-black/50 text-white border-white/40"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
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

          {/* Manual entry — collapsed by default so opening the scanner shows
              the camera, not the keyboard. Revealed automatically when the
              camera errors out, or on demand via the button below. */}
          <div className="border-t pt-4">
            {!manualEntryOpen && (
              <Button
                type="button"
                variant="outline"
                className="w-full h-11 sm:h-10"
                aria-expanded={manualEntryOpen}
                aria-controls="manual-barcode-region"
                onClick={handleRevealManualEntry}
              >
                <Search className="h-4 w-4 mr-2" />
                Enter barcode manually
              </Button>
            )}
            <div id="manual-barcode-region">
              {manualEntryOpen && (
                <form onSubmit={handleManualSubmit} className="space-y-2">
                  <Label htmlFor="manual-barcode">Enter barcode manually</Label>
                  <div className="flex gap-2">
                    <Input
                      id="manual-barcode"
                      ref={manualInputRef}
                      placeholder="e.g. 0038000845260"
                      value={manualBarcode}
                      onChange={(e) => setManualBarcode(e.target.value)}
                      inputMode="numeric"
                      className="h-11 sm:h-10"
                    />
                    <Button
                      type="submit"
                      size="icon"
                      className="h-11 w-11 sm:h-10 sm:w-10"
                      disabled={!manualBarcode.trim()}
                    >
                      <Search className="h-4 w-4" />
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full h-11 sm:h-10"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
