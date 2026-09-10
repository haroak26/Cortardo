import { createHmac, randomBytes } from "crypto";

function base32Encode(buf: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let result = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 31];
  }
  return result;
}

function base32Decode(s: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = s.replace(/=+$/, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: bigint): string {
  const counterBuf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    counterBuf[i] = Number(counter & BigInt(0xff));
    counter >>= BigInt(8);
  }
  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, "0");
}

export function generateTotpSecret(): string {
  const key = randomBytes(20);
  return base32Encode(key);
}

function getCounter(timeStep = 30): bigint {
  return BigInt(Math.floor(Date.now() / 1000 / timeStep));
}

export function generateTotp(secret: string, timeStep = 30): string {
  const key = base32Decode(secret);
  return hotp(key, getCounter(timeStep));
}

export function verifyTotp(secret: string, token: string, timeStep = 30, window = 1): boolean {
  const key = base32Decode(secret);
  const counter = getCounter(timeStep);
  for (let i = -window; i <= window; i++) {
    const expected = hotp(key, counter + BigInt(i));
    if (token === expected) return true;
  }
  return false;
}

export function buildOtpauthUrl(secret: string, issuer: string, label: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
