/**
 * Pure(ish) camera-acquisition helpers for the barcode scanner, extracted
 * from BarcodeScanner.tsx so the constraint-building and camera-selection
 * heuristics can be unit tested without a real camera — jsdom has no
 * `getUserMedia`/`enumerateDevices`, so these take their browser
 * dependencies as parameters instead of reaching for `navigator` directly.
 *
 * Root cause being fixed: `@zxing/browser`'s `decodeFromVideoDevice(undefined, ...)`
 * asks for nothing but `{ facingMode: 'environment' }` — no resolution hint —
 * so Chrome commonly negotiates a low default (~640x480). A UPC barcode
 * framed normally then has each bar only ~1px wide, below ZXing's decode
 * threshold, which is exactly why zooming to 2x (doubling pixel width) used
 * to be necessary. `buildVideoConstraints` below always requests a
 * resolution hint; `selectBestCameraDevice` additionally steers away from
 * ultra-wide/telephoto/depth rear sensors on multi-camera Android phones.
 */

/** Resolution we ask for via `ideal` (never `exact`, so a device that can't
 * do this degrades gracefully instead of throwing OverconstrainedError). */
const IDEAL_WIDTH = 2560;
const IDEAL_HEIGHT = 1440;

export interface CameraDeviceLike {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

/**
 * Builds the `video` constraints for `getUserMedia`. When `deviceId` is
 * provided (a confidently-selected rear camera from `selectBestCameraDevice`)
 * it pins that exact device; otherwise falls back to a facingMode-only
 * request, matching the component's previous camera-picking behavior. Either
 * way a resolution hint is now always included.
 */
export function buildVideoConstraints(deviceId?: string): MediaTrackConstraints {
  const resolution = {
    width: { ideal: IDEAL_WIDTH },
    height: { ideal: IDEAL_HEIGHT },
  };
  if (deviceId) {
    return { deviceId: { exact: deviceId }, ...resolution };
  }
  return { facingMode: { ideal: "environment" }, ...resolution };
}

const FRONT_RE = /\bfront\b/i;
const BACK_RE = /\b(back|rear|environment)\b/i;
const WIDE_RE = /ultra[\s-]?wide|wide[\s-]?angle/i;
const TELE_RE = /tele(photo)?/i;
const NON_COLOR_RE = /\b(depth|mono|infrared|ir)\b/i;
const INDEX_RE = /camera2?\D*(\d+)/i;

/**
 * Scores how likely a video input device is to be the primary rear color
 * camera, based on its label (only populated by the UA after permission is
 * granted — e.g. Chrome/Android's `"camera2 0, facing back"`). Higher is
 * better; front-facing cameras are disqualified outright (`-Infinity`).
 *
 * Deliberately conservative: a label that doesn't clearly say
 * "back"/"rear"/"environment" scores 0 or below, which
 * `selectBestCameraDevice` treats as "no confident match" and falls back to
 * the facingMode-only default rather than guessing wrong.
 */
export function scoreCameraLabel(label: string): number {
  if (!label) return -Infinity;
  if (FRONT_RE.test(label)) return -Infinity;

  let score = 0;
  if (BACK_RE.test(label)) score += 10;
  if (WIDE_RE.test(label)) score -= 6;
  if (TELE_RE.test(label)) score -= 6;
  if (NON_COLOR_RE.test(label)) score -= 8;

  const indexMatch = label.match(INDEX_RE);
  if (indexMatch) {
    // Main sensor is conventionally index 0 on Android's camera2 API; nudge
    // (never disqualify on its own) toward lower indices.
    score -= Math.min(Number(indexMatch[1]), 5) * 0.5;
  }
  return score;
}

/**
 * Picks the best-scoring rear camera from `enumerateDevices()` output.
 * Returns `undefined` — meaning "use the facingMode:'environment' default" —
 * when device labels aren't available yet (no permission granted for this
 * origin/session) or when nothing scores as a confident rear-camera match.
 * Never throws.
 */
export function selectBestCameraDevice(
  devices: readonly CameraDeviceLike[]
): CameraDeviceLike | undefined {
  let best: CameraDeviceLike | undefined;
  let bestScore = 0; // must strictly exceed 0 (i.e. matched a back/rear/environment token)
  for (const device of devices) {
    if (device.kind !== "videoinput" || !device.label) continue;
    const score = scoreCameraLabel(device.label);
    if (score > bestScore) {
      bestScore = score;
      best = device;
    }
  }
  return best;
}

export interface AcquireCameraStreamDeps {
  mediaDevices: Pick<MediaDevices, "enumerateDevices" | "getUserMedia">;
}

/**
 * Enumerates cameras, picks the best rear candidate (if any), and opens a
 * high-resolution stream. If a pinned `deviceId` turns out to be stale (e.g.
 * `OverconstrainedError` because the device was unplugged/reassigned between
 * `enumerateDevices()` and `getUserMedia()`), retries once with the same
 * facingMode-only fallback used when no confident camera match existed,
 * rather than failing the whole scan over a bad guess.
 */
export async function acquireCameraStream({
  mediaDevices,
}: AcquireCameraStreamDeps): Promise<MediaStream> {
  let devices: MediaDeviceInfo[] = [];
  try {
    devices = await mediaDevices.enumerateDevices();
  } catch {
    devices = [];
  }

  const preferred = selectBestCameraDevice(devices);
  try {
    return await mediaDevices.getUserMedia({
      video: buildVideoConstraints(preferred?.deviceId),
      audio: false,
    });
  } catch (err) {
    if (!preferred) throw err;
    return mediaDevices.getUserMedia({
      video: buildVideoConstraints(undefined),
      audio: false,
    });
  }
}
