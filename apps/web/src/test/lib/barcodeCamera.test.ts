import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildVideoConstraints,
  scoreCameraLabel,
  selectBestCameraDevice,
  acquireCameraStream,
  type CameraDeviceLike,
} from "@/lib/barcodeCamera";

describe("buildVideoConstraints", () => {
  it("without a deviceId — falls back to facingMode:environment, plus a resolution hint", () => {
    expect(buildVideoConstraints(undefined)).toEqual({
      facingMode: { ideal: "environment" },
      width: { ideal: 2560 },
      height: { ideal: 1440 },
    });
  });

  it("with a deviceId — pins that exact device instead of facingMode, still with the resolution hint", () => {
    expect(buildVideoConstraints("cam-123")).toEqual({
      deviceId: { exact: "cam-123" },
      width: { ideal: 2560 },
      height: { ideal: 1440 },
    });
  });

  it("resolution is always requested via ideal, never exact — this is the actual defect fix", () => {
    // The bug was that decodeFromVideoDevice's default constraints carried no
    // resolution hint at all, so Chrome negotiated ~640x480. Assert both
    // branches request an ideal (never exact) resolution so a device that
    // can't do 2560x1440 degrades instead of throwing OverconstrainedError.
    const withDevice = buildVideoConstraints("cam-1") as { width: object; height: object };
    const withoutDevice = buildVideoConstraints(undefined) as { width: object; height: object };
    for (const constraints of [withDevice, withoutDevice]) {
      expect(constraints.width).toEqual({ ideal: 2560 });
      expect(constraints.height).toEqual({ ideal: 1440 });
      expect(JSON.stringify(constraints)).not.toContain("exact\":2560");
    }
  });
});

describe("scoreCameraLabel", () => {
  it("disqualifies front-facing cameras outright", () => {
    expect(scoreCameraLabel("camera2 1, facing front")).toBe(-Infinity);
    expect(scoreCameraLabel("Front Camera")).toBe(-Infinity);
  });

  it("scores an empty label as disqualified (no confident signal to act on)", () => {
    expect(scoreCameraLabel("")).toBe(-Infinity);
  });

  it("scores a plain back-facing label positively", () => {
    expect(scoreCameraLabel("camera2 0, facing back")).toBeGreaterThan(0);
    expect(scoreCameraLabel("Back Camera")).toBeGreaterThan(0);
    expect(scoreCameraLabel("environment facing camera")).toBeGreaterThan(0);
  });

  it("penalizes ultra-wide, telephoto, and depth/mono rear sensors", () => {
    const main = scoreCameraLabel("camera2 0, facing back");
    const wide = scoreCameraLabel("camera2 2, facing back, ultra wide");
    const tele = scoreCameraLabel("camera2 3, facing back, telephoto");
    const depth = scoreCameraLabel("camera2 4, facing back, depth");

    expect(wide).toBeLessThan(main);
    expect(tele).toBeLessThan(main);
    expect(depth).toBeLessThan(main);
  });

  it("nudges toward lower camera indices without disqualifying higher ones", () => {
    const index0 = scoreCameraLabel("camera2 0, facing back");
    const index2 = scoreCameraLabel("camera2 2, facing back");
    expect(index2).toBeLessThan(index0);
    expect(index2).toBeGreaterThan(0);
  });

  it("an unrecognized label scores 0 rather than guessing", () => {
    expect(scoreCameraLabel("USB Video Device")).toBe(0);
  });
});

describe("selectBestCameraDevice", () => {
  const device = (overrides: Partial<CameraDeviceLike>): CameraDeviceLike => ({
    deviceId: "id",
    label: "",
    kind: "videoinput",
    ...overrides,
  });

  it("returns undefined when no devices have labels (permission not yet granted)", () => {
    const devices = [device({ deviceId: "a", label: "" }), device({ deviceId: "b", label: "" })];
    expect(selectBestCameraDevice(devices)).toBeUndefined();
  });

  it("returns undefined when nothing scores as a confident rear-camera match", () => {
    const devices = [device({ deviceId: "a", label: "USB Video Device" })];
    expect(selectBestCameraDevice(devices)).toBeUndefined();
  });

  it("ignores audioinput/other-kind devices even if labeled 'back'", () => {
    const devices = [
      device({ deviceId: "a", label: "Back Microphone", kind: "audioinput" as MediaDeviceKind }),
    ];
    expect(selectBestCameraDevice(devices)).toBeUndefined();
  });

  it("picks the best-scoring rear camera over an ultra-wide sensor on the same phone", () => {
    const main = device({ deviceId: "main", label: "camera2 0, facing back" });
    const wide = device({ deviceId: "wide", label: "camera2 2, facing back, ultra wide" });
    const front = device({ deviceId: "front", label: "camera2 1, facing front" });

    const best = selectBestCameraDevice([front, wide, main]);
    expect(best?.deviceId).toBe("main");
  });
});

describe("acquireCameraStream", () => {
  const fakeStream = { id: "stream-1" } as unknown as MediaStream;

  function makeMediaDevices(overrides: {
    devices?: CameraDeviceLike[];
    enumerateDevicesImpl?: () => Promise<MediaDeviceInfo[]>;
    getUserMediaImpl?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  }) {
    return {
      enumerateDevices:
        overrides.enumerateDevicesImpl ??
        vi.fn().mockResolvedValue((overrides.devices ?? []) as unknown as MediaDeviceInfo[]),
      getUserMedia: overrides.getUserMediaImpl ?? vi.fn().mockResolvedValue(fakeStream),
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("no confident camera match — requests facingMode:environment with the resolution hint", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream);
    const mediaDevices = makeMediaDevices({ devices: [], getUserMediaImpl: getUserMedia });

    const stream = await acquireCameraStream({ mediaDevices });

    expect(stream).toBe(fakeStream);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } },
      audio: false,
    });
  });

  it("confident camera match — pins that deviceId", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream);
    const mediaDevices = makeMediaDevices({
      devices: [{ deviceId: "main", label: "camera2 0, facing back", kind: "videoinput" as MediaDeviceKind }],
      getUserMediaImpl: getUserMedia,
    });

    await acquireCameraStream({ mediaDevices });

    expect(getUserMedia).toHaveBeenCalledWith({
      video: {
        deviceId: { exact: "main" },
        width: { ideal: 2560 },
        height: { ideal: 1440 },
      },
      audio: false,
    });
  });

  it("enumerateDevices rejects — treated as no devices, still opens a stream via the default constraints", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream);
    const mediaDevices = makeMediaDevices({
      enumerateDevicesImpl: vi.fn().mockRejectedValue(new Error("enumerate failed")),
      getUserMediaImpl: getUserMedia,
    });

    const stream = await acquireCameraStream({ mediaDevices });

    expect(stream).toBe(fakeStream);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } },
      audio: false,
    });
  });

  it("a stale pinned deviceId fails — retries once with the facingMode-only fallback", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new Error("OverconstrainedError"))
      .mockResolvedValueOnce(fakeStream);
    const mediaDevices = makeMediaDevices({
      devices: [{ deviceId: "main", label: "camera2 0, facing back", kind: "videoinput" as MediaDeviceKind }],
      getUserMediaImpl: getUserMedia,
    });

    const stream = await acquireCameraStream({ mediaDevices });

    expect(stream).toBe(fakeStream);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      video: { deviceId: { exact: "main" }, width: { ideal: 2560 }, height: { ideal: 1440 } },
      audio: false,
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } },
      audio: false,
    });
  });

  it("no confident match AND getUserMedia rejects — propagates the error (nothing left to retry)", async () => {
    const rejection = new Error("Permission denied");
    const getUserMedia = vi.fn().mockRejectedValue(rejection);
    const mediaDevices = makeMediaDevices({ devices: [], getUserMediaImpl: getUserMedia });

    await expect(acquireCameraStream({ mediaDevices })).rejects.toThrow("Permission denied");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
