import { createCipheriv, createDecipheriv, randomBytes, createHmac } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export type SecretGeneration = "current" | "previous";

function currentSecret(): string {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("ENCRYPTION_SECRET environment variable is not set");
  }
  return secret;
}

/**
 * Derive a 256-bit key from a secret using HMAC-SHA256
 * with a per-provider salt ("byok-{provider}") for domain separation.
 * This is equivalent to HKDF-Extract with the provider as info.
 */
function deriveKey(secret: string, provider: string): Buffer {
  return createHmac("sha256", secret)
    .update("byok-" + provider)
    .digest();
}

function decryptWithSecret(encrypted: string, provider: string, secret: string): string {
  const key = deriveKey(secret, provider);
  const data = Buffer.from(encrypted, "base64");
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(data.length - TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH, data.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

export function encryptApiKey(plaintext: string, provider: string): string {
  const key = deriveKey(currentSecret(), provider);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString("base64");
}

/**
 * Decrypt with ENCRYPTION_SECRET, then with ENCRYPTION_SECRET_PREVIOUS while a
 * rotation is in progress. The ciphertext carries no key id: GCM's auth tag
 * rejects the wrong key, so trying both is unambiguous. Reports which secret
 * worked so scripts/rotate-encryption-secret.ts can re-encrypt the old rows.
 */
export function decryptApiKeyWithGeneration(
  encrypted: string,
  provider: string,
): { plaintext: string; generation: SecretGeneration } {
  const current = currentSecret();
  try {
    return { plaintext: decryptWithSecret(encrypted, provider, current), generation: "current" };
  } catch (currentError) {
    const previous = process.env.ENCRYPTION_SECRET_PREVIOUS;
    if (!previous || previous === current) throw currentError;
    return { plaintext: decryptWithSecret(encrypted, provider, previous), generation: "previous" };
  }
}

export function decryptApiKey(encrypted: string, provider: string): string {
  return decryptApiKeyWithGeneration(encrypted, provider).plaintext;
}

/** True when the stored key decrypts with the current or previous secret. */
export function isApiKeyReadable(encrypted: string, provider: string): boolean {
  try {
    decryptApiKeyWithGeneration(encrypted, provider);
    return true;
  } catch {
    return false;
  }
}
