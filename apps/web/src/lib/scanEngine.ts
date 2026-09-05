import type { BrowserMultiFormatReader } from "@zxing/browser";
import { isBarcodeDetectorApiAvailable, getUsableBarcodeFormats } from "@/lib/barcodeDetectorSupport";

export interface ScanEngineControls {
  stop: () => void;
}

export type ScanResultCallback = (barcodeText: string) => void;
export type ScanErrorCallback = (error: unknown) => void;

/**
 * Common lifecycle both decode strategies (native `BarcodeDetector`, ZXing)
 * implement, so the component only ever drives one shape regardless of which
 * strategy got picked for the current browser/device.
 *
 * `start` takes an already-open `MediaStream` — see `acquireCameraStream` in
 * barcodeCamera.ts for why the component opens it itself with explicit
 * resolution/device constraints rather than letting either engine pick its
 * own — and is responsible for attaching it to `video`.
 */
export interface ScanEngine {
  start(
    stream: MediaStream,
    video: HTMLVideoElement,
    onResult: ScanResultCallback,
    onError?: ScanErrorCallback
  ): Promise<ScanEngineControls>;
}

/** Wraps `@zxing/browser`'s `decodeFromStream`, which attaches `stream` to
 * `video` and disposes both on `stop()`. */
export function createZXingScanEngine(reader: BrowserMultiFormatReader): ScanEngine {
  return {
    async start(stream, video, onResult, onError) {
      const controls = await reader.decodeFromStream(stream, video, (result, err) => {
        if (result) onResult(result.getText());
        if (err && err.name !== "NotFoundException") onError?.(err);
      });
      return { stop: () => controls.stop() };
    },
  };
}

/**
 * Wraps `window.BarcodeDetector` in a `requestAnimationFrame` poll loop.
 * There's no ZXing-equivalent "attach stream, decode continuously" helper to
 * borrow for the native path without depending on ZXing internals — which
 * would defeat the point of a path that exists specifically to not need
 * ZXing — so this attaches the stream and stops its tracks itself.
 */
export function createNativeScanEngine(
  DetectorCtor: typeof BarcodeDetector,
  formats: string[]
): ScanEngine {
  return {
    async start(stream, video, onResult, onError) {
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // The autoPlay/muted/playsInline attributes on the <video> already
        // cover this in practice; a rejected play() here isn't fatal to
        // detection once the stream is attached.
      }

      const detector = new DetectorCtor({ formats });
      let stopped = false;
      let rafId: number | null = null;

      const tick = () => {
        if (stopped) return;
        void (async () => {
          try {
            if (video.readyState >= video.HAVE_CURRENT_DATA) {
              const results = await detector.detect(video);
              const [first] = results;
              if (first) {
                onResult(first.rawValue);
                return;
              }
            }
          } catch (err) {
            onError?.(err);
          }
          if (!stopped) rafId = requestAnimationFrame(tick);
        })();
      };
      rafId = requestAnimationFrame(tick);

      return {
        stop: () => {
          stopped = true;
          if (rafId !== null) cancelAnimationFrame(rafId);
          stream.getVideoTracks().forEach((track) => track.stop());
          video.srcObject = null;
        },
      };
    },
  };
}

export interface ResolveScanEngineDeps {
  win: (Window & typeof globalThis) | undefined;
  createZXingReader: () => BrowserMultiFormatReader;
}

/**
 * Picks the native `BarcodeDetector` path when it exists AND supports at
 * least one grocery barcode symbology; otherwise falls back to ZXing, which
 * is what runs in Firefox, Safari, and the jsdom test environment.
 */
export async function resolveScanEngine({
  win,
  createZXingReader,
}: ResolveScanEngineDeps): Promise<ScanEngine> {
  if (isBarcodeDetectorApiAvailable(win)) {
    const formats = await getUsableBarcodeFormats(() => win.BarcodeDetector.getSupportedFormats());
    if (formats.length > 0) {
      return createNativeScanEngine(win.BarcodeDetector, formats);
    }
  }
  return createZXingScanEngine(createZXingReader());
}
