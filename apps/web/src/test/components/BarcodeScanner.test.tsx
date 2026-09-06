import { describe, test, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Shared, per-test-mutable handles for the mocked @zxing/browser reader and
 * the mocked navigator.mediaDevices.
 *
 * `vi.hoisted` lets the `vi.mock` factory (which is hoisted above imports)
 * safely reference these — each test sets `state.capabilities` /
 * `state.devices` and inspects `applyConstraintsMock`/`getUserMediaMock` to
 * assert what the scanner requested.
 *
 * The component no longer calls `decodeFromVideoDevice` (which picked its own
 * constraints internally, with no resolution hint — the root cause of the
 * "must zoom to 2x" defect). It now acquires the MediaStream itself via
 * `navigator.mediaDevices.getUserMedia` (see lib/barcodeCamera.ts) and hands
 * the already-open stream to `@zxing/browser`'s `decodeFromStream`.
 */
const { applyConstraintsMock, getUserMediaMock, enumerateDevicesMock, state } = vi.hoisted(() => ({
  applyConstraintsMock: vi.fn(),
  getUserMediaMock: vi.fn(),
  enumerateDevicesMock: vi.fn(),
  state: {
    capabilities: {} as Record<string, unknown>,
    settings: {} as Record<string, unknown>,
  },
}));

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    // Mirrors decodeFromStream(stream, videoEl, callback): attaches the
    // (already-mocked) stream to the video element's srcObject so the
    // component's post-stream `if (track)` capability block executes, then
    // returns stop controls.
    async decodeFromStream(stream: MediaStream, videoEl: HTMLVideoElement) {
      Object.defineProperty(videoEl, "srcObject", {
        value: stream,
        configurable: true,
        writable: true,
      });
      return { stop: vi.fn() };
    }
  },
}));

import { BarcodeScanner } from "@/components/inventory/BarcodeScanner";

function makeFakeTrack() {
  return {
    getCapabilities: () => state.capabilities,
    getSettings: () => state.settings,
    applyConstraints: applyConstraintsMock,
    stop: vi.fn(),
    label: "camera2 0, facing back",
  };
}

function renderScanner() {
  return render(<BarcodeScanner open onOpenChange={vi.fn()} onScan={vi.fn()} />);
}

beforeEach(() => {
  applyConstraintsMock.mockReset();
  applyConstraintsMock.mockResolvedValue(undefined);
  enumerateDevicesMock.mockReset();
  enumerateDevicesMock.mockResolvedValue([]);
  getUserMediaMock.mockReset();
  state.capabilities = {};
  state.settings = {};

  getUserMediaMock.mockImplementation(() => {
    const track = makeFakeTrack();
    const stream = { getVideoTracks: () => [track] } as unknown as MediaStream;
    return Promise.resolve(stream);
  });

  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: getUserMediaMock,
      enumerateDevices: enumerateDevicesMock,
    },
    configurable: true,
    writable: true,
  });
});

describe("BarcodeScanner — camera stream acquisition", () => {
  it("requests a resolution-hinted stream via getUserMedia (the fix for the '640x480, must zoom' defect)", async () => {
    renderScanner();

    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalled());
    expect(getUserMediaMock).toHaveBeenCalledWith({
      video: expect.objectContaining({
        width: { ideal: 2560 },
        height: { ideal: 1440 },
      }),
      audio: false,
    });
  });

  it("falls back to manual entry when getUserMedia rejects (permission denied / no camera)", async () => {
    getUserMediaMock.mockRejectedValue(new Error("Permission denied"));
    renderScanner();

    await screen.findByText(/camera unavailable/i);
    expect(screen.getByLabelText(/enter barcode manually/i)).toBeInTheDocument();
  });
});

describe("BarcodeScanner — continuous autofocus", () => {
  it("requests continuous focus when the device supports it", async () => {
    state.capabilities = { focusMode: ["single-shot", "continuous"] };
    renderScanner();

    await waitFor(() => {
      expect(applyConstraintsMock).toHaveBeenCalledWith({
        advanced: [{ focusMode: "continuous" }],
      });
    });
  });

  it("does not touch focus when focusMode is unsupported", async () => {
    // torch:true gives a deterministic DOM signal that the capability block ran.
    state.capabilities = { torch: true };
    renderScanner();

    await screen.findByRole("button", { name: /turn on torch/i });
    expect(applyConstraintsMock).not.toHaveBeenCalled();
  });

  it("does not request continuous focus when the mode list lacks it", async () => {
    state.capabilities = { torch: true, focusMode: ["manual", "single-shot"] };
    renderScanner();

    await screen.findByRole("button", { name: /turn on torch/i });
    expect(applyConstraintsMock).not.toHaveBeenCalled();
  });

  it("survives an applyConstraints rejection without showing a camera error", async () => {
    state.capabilities = { focusMode: ["continuous"] };
    applyConstraintsMock.mockRejectedValue(new Error("OverconstrainedError"));
    renderScanner();

    await waitFor(() => expect(applyConstraintsMock).toHaveBeenCalled());
    // Camera-unavailable fallback must NOT appear; live scanning text stays.
    expect(screen.queryByText(/camera unavailable/i)).not.toBeInTheDocument();
    expect(screen.getByText(/scanning — point camera at a barcode/i)).toBeInTheDocument();
  });
});

describe("BarcodeScanner — manual entry disclosure (keyboard-over-camera fix)", () => {
  it("does not render or focus the manual-entry input on open — camera view comes up first", async () => {
    renderScanner();

    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalled());

    expect(document.getElementById("manual-barcode")).not.toBeInTheDocument();
    const revealButton = screen.getByRole("button", { name: /enter barcode manually/i });
    expect(revealButton).toBeInTheDocument();
    expect(revealButton).toHaveAttribute("aria-expanded", "false");
    expect(revealButton).toHaveAttribute("aria-controls", "manual-barcode-region");
    expect(document.activeElement).not.toBe(document.getElementById("manual-barcode"));
  });

  it("reveals and focuses the manual-entry input when the reveal control is clicked", async () => {
    const user = userEvent.setup();
    renderScanner();

    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalled());

    const revealButton = screen.getByRole("button", { name: /enter barcode manually/i });
    await user.click(revealButton);

    const input = screen.getByLabelText(/enter barcode manually/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("id", "manual-barcode");
    await waitFor(() => expect(input).toHaveFocus());
    expect(
      screen.queryByRole("button", { name: /^enter barcode manually$/i })
    ).not.toBeInTheDocument();
  });

  it("auto-reveals manual entry when the camera errors out, without focusing it", async () => {
    getUserMediaMock.mockRejectedValue(new Error("Permission denied"));
    renderScanner();

    await screen.findByText(/camera unavailable/i);

    const input = screen.getByLabelText(/enter barcode manually/i);
    expect(input).toBeInTheDocument();
    expect(document.activeElement).not.toBe(input);
  });
});

/**
 * Skeleton tests retained as documentation of intended coverage.
 * These remain `.todo` pending a full camera/decode test harness.
 */
describe("BarcodeScanner Component", () => {
  describe("Camera Access", () => {
    test.todo("should request camera permission");
    test.todo("should handle camera permission denied");
    test.todo("should show camera preview");
    test.todo("should handle no camera available");
  });

  describe("Barcode Detection", () => {
    test.todo("should detect UPC-A barcode (12 digits)");
    test.todo("should detect EAN-13 barcode (13 digits)");
    test.todo("should show detected barcode on screen");
    test.todo("should handle unreadable barcode");
  });

  describe("Product Lookup", () => {
    test.todo("should fetch product info on successful scan");
    test.todo("should show loading state during lookup");
    test.todo("should display product details from cache");
    test.todo("should display product details from Open Food Facts");
    test.todo("should handle product not found");
  });

  describe("Manual Entry", () => {
    test.todo("should allow manual barcode entry");
    test.todo("should validate barcode format");
    test.todo("should search on manual entry submit");
  });

  describe("Add Item Flow", () => {
    test.todo("should pre-fill form with product data");
    test.todo("should allow editing pre-filled data");
    test.todo("should select location (pantry/fridge/freezer)");
    test.todo("should set quantity");
    test.todo("should show estimated expiration date");
    test.todo("should save item to household");
    test.todo("should show success message");
  });

  describe("Error Handling", () => {
    test.todo("should show error on API failure");
    test.todo("should retry on network error");
    test.todo("should handle camera error gracefully");
  });
});
