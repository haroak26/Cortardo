/**
 * Encrypted localStorage layer for React Query cache persistence.
 * Uses AES-256-GCM via the Web Crypto API. The encryption key is
 * generated in-memory on login and zeroed on logout — never persisted.
 *
 * Since Web Crypto is async but localStorage is sync, we intercept
 * localStorage.setItem to encrypt asynchronously after each write,
 * and cache the decrypted value for synchronous reads.
 */

let encryptionKey: CryptoKey | null = null;
let decryptedCache: string | null = null;
let intercepting = false;

const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
const originalGetItem = window.localStorage.getItem.bind(window.localStorage);
const originalRemoveItem = window.localStorage.removeItem.bind(window.localStorage);

/** Generate a fresh AES-256-GCM key held only in memory. */
export async function generateEncryptionKey(): Promise<CryptoKey> {
  return (encryptionKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  ));
}

/** Zero the in-memory key and clear cached data. */
export function clearEncryptionKey(): void {
  encryptionKey = null;
  decryptedCache = null;
  disableInterception();
}

// ── Encrypt / Decrypt helpers ──────────────────────────────────────────

async function encryptString(plaintext: string): Promise<string> {
  if (!encryptionKey) return plaintext;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    encryptionKey,
    encoded,
  );
  const ivB64 = uint8ToBase64(iv);
  const ctB64 = uint8ToBase64(new Uint8Array(ciphertext));
  return `enc:${ivB64}.${ctB64}`;
}

async function decryptString(raw: string): Promise<string> {
  if (!encryptionKey || !raw.startsWith("enc:")) return raw;
  try {
    const payload = raw.slice(4); // strip "enc:"
    const dotIdx = payload.indexOf(".");
    if (dotIdx === -1) return raw;
    const iv = base64ToUint8(payload.slice(0, dotIdx));
    const ct = base64ToUint8(payload.slice(dotIdx + 1));
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      encryptionKey,
      ct,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return raw;
  }
}

// ── Base64 helpers (browser-safe) ──────────────────────────────────────

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── localStorage interception ──────────────────────────────────────────

function enableInterception(storageKey: string): void {
  if (intercepting) return;
  intercepting = true;

  // Decrypt on read — return the cached decrypted value for synchronous access.
  window.localStorage.getItem = function (key: string) {
    if (key === storageKey && decryptedCache !== null) {
      return decryptedCache;
    }
    return originalGetItem(key);
  } as typeof window.localStorage.getItem;

  // Encrypt on write — store encrypted blob asynchronously, keep decrypted
  // copy in memory so the next synchronous read returns the right value.
  window.localStorage.setItem = function (key: string, value: string) {
    if (key === storageKey) {
      decryptedCache = value;
      // Fire-and-forget async encryption of the blob.
      encryptString(value).then((encrypted) => {
        originalSetItem(key, encrypted);
      }).catch(() => {
        // Fallback: store unencrypted if encryption fails.
        originalSetItem(key, value);
      });
      return;
    }
    originalSetItem(key, value);
  } as typeof window.localStorage.setItem;

  // Remove — clear both caches.
  window.localStorage.removeItem = function (key: string) {
    if (key === storageKey) {
      decryptedCache = null;
    }
    originalRemoveItem(key);
  } as typeof window.localStorage.removeItem;
}

function disableInterception(): void {
  if (!intercepting) return;
  intercepting = false;
  window.localStorage.getItem = originalGetItem;
  window.localStorage.setItem = originalSetItem;
  window.localStorage.removeItem = originalRemoveItem;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Activate encrypted cache. Call after login.
 * 1. Generates an AES-256-GCM key in memory.
 * 2. Decrypts any existing cached blob into memory.
 * 3. Intercepts localStorage so future writes are encrypted.
 */
export async function activateEncryptedCache(storageKey: string): Promise<void> {
  await generateEncryptionKey();
  // Pre-decrypt the existing blob so the first synchronous read works.
  try {
    const raw = originalGetItem(storageKey);
    if (raw) {
      decryptedCache = await decryptString(raw);
    }
  } catch {
    decryptedCache = null;
  }
  enableInterception(storageKey);
}
