/**
 * AES-256-GCM envelope encryption for household-supplied LLM API keys.
 *
 * The key-encryption-key (KEK) comes from `MEAL_PLAN_KEK` (base64, must decode to
 * exactly 32 bytes). There is no plaintext fallback — a missing or malformed KEK is a
 * hard failure, by design (see docs/plans/meal-planning.md §6.1).
 *
 * `additionalData` is always the household id: a ciphertext copied into another
 * household's row fails to decrypt (AES-GCM authentication failure), which is a
 * cryptographic backstop under the IDOR predicate enforced at the query layer.
 *
 * Rotation: `MEAL_PLAN_KEK_PREVIOUS` supports decrypt-only fallback. Encrypt always
 * uses the current KEK; decrypt tries current first, then previous. Callers should
 * re-encrypt (re-save) a row once it has been read via the previous key.
 *
 * Uses Bun's WebCrypto (`crypto.subtle`) — no new dependency.
 */

const AES_KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const GCM_TAG_LENGTH_BYTES = 16;

/** kek_version recorded on every row encrypted with the current MEAL_PLAN_KEK. */
export const CURRENT_KEK_VERSION = 1;

/**
 * Thrown when `MEAL_PLAN_KEK` / `MEAL_PLAN_KEK_PREVIOUS` is missing or malformed.
 * Always an operator/config problem, never caused by user input — callers should
 * treat this as a 500, not attempt to interpret it as "bad API key".
 *
 * `reason` lets callers (route handlers, boot logging) distinguish "not set at all"
 * from "set but wrong length" — these used to collapse into one identical message
 * both in the API response and in an incident where an operator "fixed" a missing KEK
 * by setting a malformed one and saw the exact same wall (see docs/plans or the
 * postmortem this fixes: `must decode to exactly 32 bytes` only ever reached the
 * server log, never the browser).
 */
export class KekConfigError extends Error {
  readonly reason: "absent" | "malformed";
  constructor(message: string, reason: "absent" | "malformed") {
    super(message);
    this.name = "KekConfigError";
    this.reason = reason;
  }
}

/**
 * Thrown when a stored ciphertext cannot be authenticated with any available KEK —
 * wrong household, tampered data, or the KEK that encrypted it is gone. Callers MUST
 * surface this as "re-enter your API key", never a generic 500 and never a silent
 * "no key configured".
 */
export class SecretDecryptionError extends Error {
  constructor(message = "Unable to decrypt stored secret") {
    super(message);
    this.name = "SecretDecryptionError";
  }
}

export interface EncryptedSecret {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
  kekVersion: number;
}

function decodeBase64Kek(envVar: string, raw: string): Uint8Array {
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== AES_KEY_LENGTH_BYTES) {
    throw new KekConfigError(
      `${envVar} must decode to exactly ${AES_KEY_LENGTH_BYTES} bytes (got ${bytes.length}). ` +
        `The classic mistake is pasting a 32-CHARACTER string instead of the output of ` +
        `\`openssl rand -base64 32\`, which is 44 characters long.`,
      "malformed"
    );
  }
  return new Uint8Array(bytes);
}

function loadRequiredKek(envVar: "MEAL_PLAN_KEK"): Uint8Array {
  const raw = process.env[envVar];
  if (!raw || raw.trim() === "") {
    throw new KekConfigError(
      `${envVar} is not set. Refusing to encrypt/decrypt secrets without a key-encryption key ` +
        `— there is no plaintext fallback.`,
      "absent"
    );
  }
  return decodeBase64Kek(envVar, raw);
}

function loadOptionalKek(envVar: "MEAL_PLAN_KEK_PREVIOUS"): Uint8Array | null {
  const raw = process.env[envVar];
  if (!raw || raw.trim() === "") return null;
  return decodeBase64Kek(envVar, raw);
}

async function importAesGcmKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Encrypts `plaintext` under the current MEAL_PLAN_KEK, binding it to `householdId` via
 * AES-GCM additionalData. Always uses a fresh random 12-byte IV. Throws KekConfigError
 * if MEAL_PLAN_KEK is absent or the wrong length — never falls back to plaintext.
 */
export async function encryptSecret(
  plaintext: string,
  householdId: string
): Promise<EncryptedSecret> {
  const kek = loadRequiredKek("MEAL_PLAN_KEK");
  const key = await importAesGcmKey(kek);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const encoder = new TextEncoder();

  const combined = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(householdId) },
      key,
      encoder.encode(plaintext)
    )
  );

  // WebCrypto appends the 16-byte auth tag to the end of the ciphertext; split it out
  // because the plan stores IV / ciphertext / tag in separate columns.
  const tag = combined.slice(combined.length - GCM_TAG_LENGTH_BYTES);
  const ciphertext = combined.slice(0, combined.length - GCM_TAG_LENGTH_BYTES);

  return {
    ciphertext: toBase64(ciphertext),
    iv: toBase64(iv),
    tag: toBase64(tag),
    kekVersion: CURRENT_KEK_VERSION,
  };
}

async function tryDecryptWith(
  kek: Uint8Array,
  payload: EncryptedSecret,
  householdId: string
): Promise<string | null> {
  try {
    const key = await importAesGcmKey(kek);
    const iv = fromBase64(payload.iv);
    const combined = concatBytes(fromBase64(payload.ciphertext), fromBase64(payload.tag));
    const plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(householdId) },
      key,
      combined
    );
    return new TextDecoder().decode(plainBuf);
  } catch {
    // AES-GCM authentication failure is intentionally opaque — wrong key, wrong
    // household (AAD mismatch), or tampered ciphertext all land here identically.
    return null;
  }
}

/**
 * Decrypts a stored secret for `householdId`. Tries the current MEAL_PLAN_KEK first,
 * then MEAL_PLAN_KEK_PREVIOUS if configured (rotation support).
 *
 * Throws:
 * - KekConfigError if MEAL_PLAN_KEK itself is absent/malformed (operator problem).
 * - SecretDecryptionError if neither key authenticates the ciphertext — this is the
 *   distinguishable "re-enter your API key" signal callers must map to a user-facing
 *   prompt, not a 500 and not a silent "no key configured".
 */
export async function decryptSecret(
  payload: EncryptedSecret,
  householdId: string
): Promise<string> {
  const currentKek = loadRequiredKek("MEAL_PLAN_KEK");
  const viaCurrent = await tryDecryptWith(currentKek, payload, householdId);
  if (viaCurrent !== null) return viaCurrent;

  const previousKek = loadOptionalKek("MEAL_PLAN_KEK_PREVIOUS");
  if (previousKek) {
    const viaPrevious = await tryDecryptWith(previousKek, payload, householdId);
    if (viaPrevious !== null) return viaPrevious;
  }

  throw new SecretDecryptionError();
}

/** Last 4 characters of a plaintext secret, for display (e.g. "sk-...7f2c"). */
export function lastFour(plaintext: string): string {
  return plaintext.slice(-4);
}

/**
 * SHA-256 fingerprint prefix of a plaintext secret — lets the UI answer "is this the
 * same key I already saved?" without ever storing or displaying the key itself.
 */
export async function fingerprintSecret(plaintext: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(plaintext));
  return Buffer.from(digest).toString("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------------
// Boot-time diagnostics (self-diagnosing operator misconfiguration).
//
// Incident this fixes: a Synology operator set MEAL_PLAN_KEK to a 32-CHARACTER string
// instead of the 44-character output of `openssl rand -base64 32` (which decodes to
// 32 BYTES). The browser showed only "Server is not configured to store API keys"
// (500) — IDENTICAL whether the KEK was missing entirely or merely malformed — so the
// operator "fixed" it by setting a value and hit the exact same wall. The real reason
// (`must decode to exactly 32 bytes`) existed only in server logs, awkward to reach
// from Synology's Container Manager, and nothing surfaced until the first save, long
// after deploy. These two functions let index.ts check and log loudly at boot
// instead, without throwing — encryptSecret/decryptSecret above are the actual
// enforcement point and are untouched by this.
// ---------------------------------------------------------------------------------

export type MealPlanKekBootStatus =
  | { state: "absent" }
  | { state: "valid" }
  | { state: "malformed"; actualBytes: number };

/**
 * Boot-time-only check. Mirrors loadRequiredKek's absent-vs-malformed distinction but
 * NEVER throws — it only classifies, so index.ts can log the right message without
 * this feature's misconfiguration taking the whole process down.
 */
export function checkMealPlanKekBootStatus(): MealPlanKekBootStatus {
  const raw = process.env.MEAL_PLAN_KEK;
  if (!raw || raw.trim() === "") return { state: "absent" };
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== AES_KEY_LENGTH_BYTES) {
    return { state: "malformed", actualBytes: bytes.length };
  }
  return { state: "valid" };
}

/**
 * Logs `status` at the appropriate level. ABSENT is a supported, benign
 * configuration — per-household keys are simply disabled, the container-wide
 * LLM_PROVIDER/*_API_KEY path is unaffected — so it gets a single clear INFO line.
 * MALFORMED gets a loud, multi-line, hard-to-miss error block naming the exact
 * problem and the fix. Neither ever calls process.exit: meal planning is one feature
 * among several (inventory, barcode, receipts), so a bad KEK must fail only that
 * feature, never the app.
 */
export function logMealPlanKekBootStatus(
  status: MealPlanKekBootStatus = checkMealPlanKekBootStatus()
): void {
  if (status.state === "valid") {
    console.log("✓ MEAL_PLAN_KEK is present and decodes to 32 bytes");
    return;
  }

  if (status.state === "absent") {
    console.log(
      "ℹ MEAL_PLAN_KEK is not set — per-household AI API keys are disabled (a household " +
        "cannot save its own provider key). The container-wide LLM_PROVIDER/*_API_KEY " +
        "fallback still works for meal planning and is unaffected."
    );
    return;
  }

  // malformed
  console.error(
    [
      "",
      "################################################################################",
      "# MEAL_PLAN_KEK IS MISCONFIGURED — per-household AI API keys are DISABLED     #",
      "################################################################################",
      `# Decoded to ${status.actualBytes} bytes; it MUST decode to exactly 32 bytes.`,
      "#",
      "# The classic mistake: pasting a 32-CHARACTER string instead of the output of",
      "#   openssl rand -base64 32",
      "# which is 44 characters long (base64 of 32 raw bytes) — count the characters",
      "# if you're unsure which one you have.",
      "#",
      "# Fix: generate a real key, set MEAL_PLAN_KEK to that 44-character value in your",
      "# .env, and RECREATE the container (a plain restart reuses the old environment —",
      "# `docker compose up -d --force-recreate api`).",
      "#",
      "# This is NOT fatal — the server keeps running. Inventory, barcode scanning, and",
      "# receipt parsing are all unaffected. Only per-household AI API key storage",
      "# (Settings > AI provider) is disabled until this is fixed: saving or testing a",
      "# key there will fail with a clear, non-generic error referencing this log line.",
      "################################################################################",
      "",
    ].join("\n")
  );
}
