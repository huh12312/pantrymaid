import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createZXingScanEngine,
  createNativeScanEngine,
  resolveScanEngine,
} from "@/lib/scanEngine";
import type { BrowserMultiFormatReader } from "@zxing/browser";

describe("resolveScanEngine — native BarcodeDetector vs ZXing fallback selection", () => {
  it("no BarcodeDetector on window (Firefox/Safari/jsdom) — falls back to ZXing", async () => {
    const createZXingReader = vi.fn().mockReturnValue({} as BrowserMultiFormatReader);
    const engine = await resolveScanEngine({
      win: {} as Window & typeof globalThis,
      createZXingReader,
    });

    expect(createZXingReader).toHaveBeenCalledTimes(1);
    expect(engine).toBeDefined();
  });

  it("BarcodeDetector exists but supports none of our grocery formats — falls back to ZXing", async () => {
    const createZXingReader = vi.fn().mockReturnValue({} as BrowserMultiFormatReader);
    class FakeDetector {
      static getSupportedFormats() {
        return Promise.resolve(["qr_code", "aztec"]);
      }
    }
    const win = { BarcodeDetector: FakeDetector } as unknown as Window & typeof globalThis;

    await resolveScanEngine({ win, createZXingReader });

    expect(createZXingReader).toHaveBeenCalledTimes(1);
  });

  it("BarcodeDetector exists and supports a grocery format — uses the native path, never touching ZXing", async () => {
    const createZXingReader = vi.fn().mockReturnValue({} as BrowserMultiFormatReader);
    class FakeDetector {
      static getSupportedFormats() {
        return Promise.resolve(["ean_13", "qr_code"]);
      }
    }
    const win = { BarcodeDetector: FakeDetector } as unknown as Window & typeof globalThis;

    await resolveScanEngine({ win, createZXingReader });

    expect(createZXingReader).not.toHaveBeenCalled();
  });

  it("getSupportedFormats rejects — treated as unusable, falls back to ZXing", async () => {
    const createZXingReader = vi.fn().mockReturnValue({} as BrowserMultiFormatReader);
    class FakeDetector {
      static getSupportedFormats() {
        return Promise.reject(new Error("boom"));
      }
    }
    const win = { BarcodeDetector: FakeDetector } as unknown as Window & typeof globalThis;

    await resolveScanEngine({ win, createZXingReader });

    expect(createZXingReader).toHaveBeenCalledTimes(1);
  });
});

describe("createZXingScanEngine", () => {
  function fakeStream(): MediaStream {
    return {} as MediaStream;
  }
  function fakeVideo(): HTMLVideoElement {
    return {} as HTMLVideoElement;
  }

  it("start() forwards decodeFromStream's successful result via getText()", async () => {
    const stopSpy = vi.fn();
    let capturedCallback: (result: unknown, err: unknown) => void = () => {};
    const reader = {
      decodeFromStream: vi.fn((_stream, _video, cb) => {
        capturedCallback = cb;
        return Promise.resolve({ stop: stopSpy });
      }),
    } as unknown as BrowserMultiFormatReader;

    const engine = createZXingScanEngine(reader);
    const onResult = vi.fn();
    const onError = vi.fn();
    const controls = await engine.start(fakeStream(), fakeVideo(), onResult, onError);

    capturedCallback({ getText: () => "012345678905" }, null);
    expect(onResult).toHaveBeenCalledWith("012345678905");
    expect(onError).not.toHaveBeenCalled();

    controls.stop();
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it("swallows NotFoundException (the expected 'nothing decoded this frame' signal)", async () => {
    let capturedCallback: (result: unknown, err: unknown) => void = () => {};
    const reader = {
      decodeFromStream: vi.fn((_stream, _video, cb) => {
        capturedCallback = cb;
        return Promise.resolve({ stop: vi.fn() });
      }),
    } as unknown as BrowserMultiFormatReader;

    const engine = createZXingScanEngine(reader);
    const onResult = vi.fn();
    const onError = vi.fn();
    await engine.start(fakeStream(), fakeVideo(), onResult, onError);

    capturedCallback(null, { name: "NotFoundException" });
    expect(onResult).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("forwards real decode errors (not NotFoundException) to onError", async () => {
    let capturedCallback: (result: unknown, err: unknown) => void = () => {};
    const reader = {
      decodeFromStream: vi.fn((_stream, _video, cb) => {
        capturedCallback = cb;
        return Promise.resolve({ stop: vi.fn() });
      }),
    } as unknown as BrowserMultiFormatReader;

    const engine = createZXingScanEngine(reader);
    const onError = vi.fn();
    await engine.start(fakeStream(), fakeVideo(), vi.fn(), onError);

    const realError = { name: "ChecksumException" };
    capturedCallback(null, realError);
    expect(onError).toHaveBeenCalledWith(realError);
  });
});

describe("createNativeScanEngine", () => {
  function fakeTrack() {
    return { stop: vi.fn() };
  }
  function fakeStream(track: { stop: ReturnType<typeof vi.fn> }): MediaStream {
    return { getVideoTracks: () => [track] } as unknown as MediaStream;
  }
  function fakeVideo(): HTMLVideoElement {
    return {
      srcObject: null,
      readyState: 4, // HAVE_ENOUGH_DATA
      HAVE_CURRENT_DATA: 2,
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches the stream to the video element and plays it", async () => {
    const track = fakeTrack();
    const stream = fakeStream(track);
    const video = fakeVideo();
    class FakeDetector {
      detect() {
        return Promise.resolve([]);
      }
    }
    const engine = createNativeScanEngine(FakeDetector as unknown as typeof BarcodeDetector, [
      "ean_13",
    ]);

    const controls = await engine.start(stream, video, vi.fn());
    expect(video.srcObject).toBe(stream);
    expect(video.play).toHaveBeenCalledTimes(1);
    controls.stop();
  });

  it("reports the first detected barcode's rawValue via onResult", async () => {
    const track = fakeTrack();
    const stream = fakeStream(track);
    const video = fakeVideo();
    class FakeDetector {
      detect() {
        return Promise.resolve([{ rawValue: "012345678905", format: "ean_13" }]);
      }
    }
    const engine = createNativeScanEngine(FakeDetector as unknown as typeof BarcodeDetector, [
      "ean_13",
    ]);

    const onResult = vi.fn();
    const controls = await engine.start(stream, video, onResult);

    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith("012345678905"));
    controls.stop();
  });

  it("a detect() rejection is reported via onError without crashing the poll loop", async () => {
    const track = fakeTrack();
    const stream = fakeStream(track);
    const video = fakeVideo();
    class FakeDetector {
      detect() {
        return Promise.reject(new Error("detect failed"));
      }
    }
    const engine = createNativeScanEngine(FakeDetector as unknown as typeof BarcodeDetector, [
      "ean_13",
    ]);

    const onError = vi.fn();
    const controls = await engine.start(stream, video, vi.fn(), onError);

    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    controls.stop();
  });

  it("stop() stops all video tracks and clears srcObject", async () => {
    const track = fakeTrack();
    const stream = fakeStream(track);
    const video = fakeVideo();
    class FakeDetector {
      detect() {
        return Promise.resolve([]);
      }
    }
    const engine = createNativeScanEngine(FakeDetector as unknown as typeof BarcodeDetector, [
      "ean_13",
    ]);

    const controls = await engine.start(stream, video, vi.fn());
    controls.stop();

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
  });

  it("skips detect() while the video isn't ready (readyState below HAVE_CURRENT_DATA)", async () => {
    const track = fakeTrack();
    const stream = fakeStream(track);
    const video = {
      srcObject: null,
      readyState: 0, // HAVE_NOTHING
      HAVE_CURRENT_DATA: 2,
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;
    const detect = vi.fn().mockResolvedValue([]);
    class FakeDetector {
      detect = detect;
    }
    const engine = createNativeScanEngine(FakeDetector as unknown as typeof BarcodeDetector, [
      "ean_13",
    ]);

    const controls = await engine.start(stream, video, vi.fn());
    // Give the rAF loop a couple of turns to prove it's not calling detect().
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(detect).not.toHaveBeenCalled();
    controls.stop();
  });
});
