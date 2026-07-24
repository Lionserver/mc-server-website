const MIN_PBKDF2_ITERATIONS = 100_000;
const MAX_PBKDF2_ITERATIONS = 2_000_000;

export function isPbkdf2PasswordHash(value) {
  if (typeof value !== "string") return false;
  const parts = value.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2" || !/^\d+$/.test(parts[1])) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < MIN_PBKDF2_ITERATIONS || iterations > MAX_PBKDF2_ITERATIONS) return false;
  try {
    const salt = base64UrlBytes(parts[2]);
    const digest = base64UrlBytes(parts[3]);
    return salt.length >= 16 && salt.length <= 64 && digest.length >= 32 && digest.length <= 64;
  } catch {
    return false;
  }
}

export function isTotpSecret(value) {
  if (typeof value !== "string" || !/^[A-Z2-7]{16,128}$/.test(value)) return false;
  try {
    return decodeBase32(value).length >= 10;
  } catch {
    return false;
  }
}

export async function verifyPbkdf2Password(password, stored) {
  if (typeof password !== "string" || !isPbkdf2PasswordHash(stored)) return false;
  const [, iterationsText, saltText, digestText] = stored.split("$");
  try {
    const iterations = Number(iterationsText);
    const salt = base64UrlBytes(saltText);
    const expected = base64UrlBytes(digestText);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const derived = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      key,
      expected.length * 8,
    ));
    return constantTimeEqualBytes(derived, expected);
  } catch (error) {
    console.warn("admin password verification error", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}

export async function verifyTotpCode(code, secret, nowMs = Date.now()) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code) || !isTotpSecret(secret)) return false;
  try {
    const secretBytes = decodeBase32(secret);
    const counter = Math.floor(nowMs / 1000 / 30);
    for (const offset of [-1, 0, 1]) {
      const buffer = new ArrayBuffer(8);
      const view = new DataView(buffer);
      const value = counter + offset;
      view.setUint32(0, Math.floor(value / 2 ** 32));
      view.setUint32(4, value >>> 0);
      const key = await crypto.subtle.importKey(
        "raw",
        secretBytes.slice().buffer,
        { name: "HMAC", hash: "SHA-1" },
        false,
        ["sign"],
      );
      const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, buffer));
      const index = signature[signature.length - 1] & 0x0f;
      const binary = ((signature[index] & 0x7f) << 24)
        | (signature[index + 1] << 16)
        | (signature[index + 2] << 8)
        | signature[index + 3];
      const expected = String(binary % 1_000_000).padStart(6, "0");
      if (constantTimeEqualBytes(new TextEncoder().encode(code), new TextEncoder().encode(expected))) return true;
    }
  } catch (error) {
    console.warn("admin TOTP verification error", {
      name: error instanceof Error ? error.name : "unknown",
    });
  }
  return false;
}

function decodeBase32(value) {
  if (!/^[A-Z2-7]+$/.test(value)) throw new Error("invalid base32");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("invalid base32");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  return bytes;
}

function base64UrlBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const decoded = atob(normalized);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function constantTimeEqualBytes(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}
