import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';

const kms = new KMSClient({});

/** Cache entry storing decrypted plaintext and its expiry time. */
interface CacheEntry {
  plaintext: string;
  expiresAt: number;
}

/** In-memory cache for decrypted values. Persists across warm Lambda invocations. */
const decryptCache = new Map<string, CacheEntry>();

/** Cache TTL in milliseconds (5 minutes). */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Maximum cache entries — evict oldest on overflow. */
const MAX_CACHE_ENTRIES = 100;

/**
 * Encrypts a plaintext string using KMS and returns a Base64-encoded ciphertext.
 *
 * @param plaintext - The string to encrypt.
 * @returns Base64-encoded ciphertext.
 */
export async function encrypt(plaintext: string): Promise<string> {
  const result = await kms.send(new EncryptCommand({
    KeyId: process.env.KMS_KEY_ID!,
    Plaintext: new TextEncoder().encode(plaintext),
  }));
  if (!result.CiphertextBlob) {
    throw new Error('KMS encrypt returned no ciphertext');
  }
  return Buffer.from(result.CiphertextBlob).toString('base64');
}

/**
 * Decrypts a Base64-encoded KMS ciphertext back to plaintext.
 * Results are cached in memory for 5 minutes to avoid excessive KMS calls.
 *
 * @param ciphertextBase64 - The Base64-encoded ciphertext to decrypt.
 * @returns The decrypted plaintext string.
 */
export async function decrypt(ciphertextBase64: string): Promise<string> {
  const cached = decryptCache.get(ciphertextBase64);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.plaintext;
  }

  const result = await kms.send(new DecryptCommand({
    CiphertextBlob: Buffer.from(ciphertextBase64, 'base64'),
  }));
  if (!result.Plaintext) {
    throw new Error('KMS decrypt returned no plaintext');
  }
  const plaintext = new TextDecoder().decode(result.Plaintext);

  // Evict oldest entry if cache is at capacity
  if (decryptCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = decryptCache.keys().next().value;
    if (oldestKey) decryptCache.delete(oldestKey);
  }

  decryptCache.set(ciphertextBase64, {
    plaintext,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return plaintext;
}

/**
 * Masks an API key for safe display, showing only the last 4 characters.
 *
 * @param apiKey - The full API key.
 * @returns A masked string like '••••••••abcd'.
 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return apiKey;
  return '\u2022'.repeat(8) + apiKey.slice(-4);
}
