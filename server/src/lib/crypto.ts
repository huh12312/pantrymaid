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
 */
export class KekConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KekConfigError";
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
        `Generate with: openssl rand -base64 32`
    );
  }
  return new Uint8Array(bytes);
}

function loadRequiredKek(envVar: "MEAL_PLAN_KEK"): Uint8Array {
  const raw = process.env[envVar];
  if (!raw || raw.trim() === "") {
    throw new KekConfigError(
      `${envVar} is not set. Refusing to encrypt/decrypt secrets without a key-encryption key ` +
        `— there is no plaintext fallback.`
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
