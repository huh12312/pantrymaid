// Minimal ambient types for the Shape Detection API's `BarcodeDetector`.
// Not yet part of TypeScript's bundled DOM lib (TS 5.9 as of this writing),
// but shipped in Chrome/Chromium (desktop and Android) behind a runtime
// feature check — never assume it exists without checking
// `"BarcodeDetector" in window` first (see barcodeDetectorSupport.ts).
// Spec: https://wicg.github.io/shape-detection-api/#barcode-detection-api

interface BarcodeDetectorOptions {
  formats?: string[];
}

interface DetectedBarcode {
  readonly boundingBox: DOMRectReadOnly;
  readonly rawValue: string;
  readonly format: string;
  readonly cornerPoints: ReadonlyArray<{ x: number; y: number }>;
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  static getSupportedFormats(): Promise<string[]>;
  detect(image: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface Window {
  BarcodeDetector?: typeof BarcodeDetector;
}
