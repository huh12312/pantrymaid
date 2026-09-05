import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  encryptSecret,
  decryptSecret,
  lastFour,
  fingerprintSecret,
  KekConfigError,
  SecretDecryptionError,
  type EncryptedSecret,
} from "../../lib/crypto";

const ORIGINAL_KEK = process.env.MEAL_PLAN_KEK;
const ORIGINAL_KEK_PREVIOUS = process.env.MEAL_PLAN_KEK_PREVIOUS;

function randomBase64Kek(byteLength = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(byteLength))).toString("base64");
}

const HOUSEHOLD_A = "11111111-1111-1111-1111-111111111111";
const HOUSEHOLD_B = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  process.env.MEAL_PLAN_KEK = randomBase64Kek();
  delete process.env.MEAL_PLAN_KEK_PREVIOUS;
});

afterEach(() => {
  if (ORIGINAL_KEK === undefined) delete process.env.MEAL_PLAN_KEK;
  else process.env.MEAL_PLAN_KEK = ORIGINAL_KEK;
  if (ORIGINAL_KEK_PREVIOUS === undefined) delete process.env.MEAL_PLAN_KEK_PREVIOUS;
  else process.env.MEAL_PLAN_KEK_PREVIOUS = ORIGINAL_KEK_PREVIOUS;
});

describe("encryptSecret / decryptSecret round-trip", () => {
  test("decrypts back to the original plaintext for the same household", async () => {
    const plaintext = "sk-test-abcdef1234567890";
    const encrypted = await encryptSecret(plaintext, HOUSEHOLD_A);

    expect(encrypted.ciphertext).not.toBe(plaintext);
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.tag).toBeTruthy();
    expect(encrypted.kekVersion).toBe(1);

    const decrypted = await decryptSecret(encrypted, HOUSEHOLD_A);
    expect(decrypted).toBe(plaintext);
  });

  test("uses a fresh random IV per write — two encryptions of the same plaintext differ", async () => {
    const plaintext = "sk-test-same-key-both-times";
    const first = await encryptSecret(plaintext, HOUSEHOLD_A);
    const second = await encryptSecret(plaintext, HOUSEHOLD_A);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);

    // Both must still independently decrypt correctly.
    expect(await decryptSecret(first, HOUSEHOLD_A)).toBe(plaintext);
    expect(await decryptSecret(second, HOUSEHOLD_A)).toBe(plaintext);
  });
});

describe("household-bound additionalData (AAD)", () => {
  test("a ciphertext copied into another household's row fails to decrypt", async () => {
    const encrypted = await encryptSecret("sk-belongs-to-household-a", HOUSEHOLD_A);

    await expect(decryptSecret(encrypted, HOUSEHOLD_B)).rejects.toThrow(SecretDecryptionError);
  });

  test("decrypting with the correct household id still works after the AAD-mismatch attempt", async () => {
    const encrypted = await encryptSecret("sk-belongs-to-household-a", HOUSEHOLD_A);

    await expect(decryptSecret(encrypted, HOUSEHOLD_B)).rejects.toThrow(SecretDecryptionError);
    // Confirms the failure above wasn't destructive / stateful.
    expect(await decryptSecret(encrypted, HOUSEHOLD_A)).toBe("sk-belongs-to-household-a");
  });
});

describe("missing or malformed KEK — never falls back to plaintext", () => {
  test("throws KekConfigError when MEAL_PLAN_KEK is unset", async () => {
    delete process.env.MEAL_PLAN_KEK;
    await expect(encryptSecret("sk-anything", HOUSEHOLD_A)).rejects.toThrow(KekConfigError);
  });

  test("throws KekConfigError when MEAL_PLAN_KEK is empty string", async () => {
    process.env.MEAL_PLAN_KEK = "";
    await expect(encryptSecret("sk-anything", HOUSEHOLD_A)).rejects.toThrow(KekConfigError);
  });

  test("throws KekConfigError when MEAL_PLAN_KEK decodes to fewer than 32 bytes", async () => {
    process.env.MEAL_PLAN_KEK = randomBase64Kek(16);
    await expect(encryptSecret("sk-anything", HOUSEHOLD_A)).rejects.toThrow(KekConfigError);
  });

  test("throws KekConfigError when MEAL_PLAN_KEK decodes to more than 32 bytes", async () => {
    process.env.MEAL_PLAN_KEK = randomBase64Kek(34);
    await expect(encryptSecret("sk-anything", HOUSEHOLD_A)).rejects.toThrow(KekConfigError);
  });

  test("decryptSecret also requires a valid current KEK, even for the previous-key fallback path", async () => {
    const encrypted = await encryptSecret("sk-anything", HOUSEHOLD_A);
    delete process.env.MEAL_PLAN_KEK;
    process.env.MEAL_PLAN_KEK_PREVIOUS = randomBase64Kek();
    await expect(decryptSecret(encrypted, HOUSEHOLD_A)).rejects.toThrow(KekConfigError);
  });
});

describe("KEK rotation via MEAL_PLAN_KEK_PREVIOUS", () => {
  test("decrypts data written under the old KEK once it has moved to MEAL_PLAN_KEK_PREVIOUS", async () => {
    const oldKek = process.env.MEAL_PLAN_KEK!;
    const encrypted = await encryptSecret("sk-encrypted-before-rotation", HOUSEHOLD_A);

    // Simulate rotation: a fresh current KEK, the old one demoted to "previous".
    process.env.MEAL_PLAN_KEK = randomBase64Kek();
    process.env.MEAL_PLAN_KEK_PREVIOUS = oldKek;

    const decrypted = await decryptSecret(encrypted, HOUSEHOLD_A);
    expect(decrypted).toBe("sk-encrypted-before-rotation");
  });

  test("new writes after rotation use the current KEK, not the previous one", async () => {
    const oldKek = process.env.MEAL_PLAN_KEK!;
    process.env.MEAL_PLAN_KEK = randomBase64Kek();
    process.env.MEAL_PLAN_KEK_PREVIOUS = oldKek;

    const encryptedAfterRotation = await encryptSecret("sk-encrypted-after-rotation", HOUSEHOLD_A);

    // Remove the previous key entirely — decrypt must still succeed via current.
    delete process.env.MEAL_PLAN_KEK_PREVIOUS;
    expect(await decryptSecret(encryptedAfterRotation, HOUSEHOLD_A)).toBe(
      "sk-encrypted-after-rotation"
    );
  });

  test("without MEAL_PLAN_KEK_PREVIOUS configured, old-KEK data is unreadable (SecretDecryptionError, not a crash)", async () => {
    const encrypted = await encryptSecret("sk-encrypted-before-rotation", HOUSEHOLD_A);
    process.env.MEAL_PLAN_KEK = randomBase64Kek(); // rotate, but forget to set _PREVIOUS
    await expect(decryptSecret(encrypted, HOUSEHOLD_A)).rejects.toThrow(SecretDecryptionError);
  });
});

describe("tamper detection", () => {
  test("a modified ciphertext byte fails authentication", async () => {
    const encrypted = await encryptSecret("sk-tamper-target", HOUSEHOLD_A);
    const tampered: EncryptedSecret = {
      ...encrypted,
      ciphertext: tamperBase64(encrypted.ciphertext),
    };
    await expect(decryptSecret(tampered, HOUSEHOLD_A)).rejects.toThrow(SecretDecryptionError);
  });

  test("a modified auth tag fails authentication", async () => {
    const encrypted = await encryptSecret("sk-tamper-target", HOUSEHOLD_A);
    const tampered: EncryptedSecret = { ...encrypted, tag: tamperBase64(encrypted.tag) };
    await expect(decryptSecret(tampered, HOUSEHOLD_A)).rejects.toThrow(SecretDecryptionError);
  });

  test("a modified IV fails authentication", async () => {
    const encrypted = await encryptSecret("sk-tamper-target", HOUSEHOLD_A);
    const tampered: EncryptedSecret = { ...encrypted, iv: tamperBase64(encrypted.iv) };
    await expect(decryptSecret(tampered, HOUSEHOLD_A)).rejects.toThrow(SecretDecryptionError);
  });
});

describe("lastFour / fingerprintSecret", () => {
  test("lastFour returns exactly the trailing 4 characters", () => {
    expect(lastFour("sk-openai-abcd1234wxyz")).toBe("wxyz");
  });

  test("fingerprintSecret is deterministic and distinguishes different keys", async () => {
    const a1 = await fingerprintSecret("sk-key-a");
    const a2 = await fingerprintSecret("sk-key-a");
    const b = await fingerprintSecret("sk-key-b");

    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1).not.toContain("sk-key-a");
  });
});

// Flips every bit of the first decoded byte and re-encodes. Manipulating bytes
// directly (rather than swapping a base64 character) guarantees the underlying data
// actually changes — some trailing base64 characters only encode padding bits that
// round-trip identically even after being "changed".
function tamperBase64(value: string): string {
  const bytes = Buffer.from(value, "base64");
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;
  return bytes.toString("base64");
}
