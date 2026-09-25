// zaina-platform/src/staff/passwords.ts
//
// Staff passwords, stored as scrypt hashes with their parameters:
//   scrypt$N$r$p$salt$hash   (salt and hash in base64)

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** At least 10 characters, not all the same kind: letters and something else. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "Use at most 200 characters.";
  if (!/[a-z]/i.test(password) || !/[^a-z]/i.test(password)) return "Mix letters with numbers or symbols.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash || ![n, r, p].every((value) => /^\d{1,7}$/.test(value ?? ""))) return false;
  const expected = Buffer.from(hash, "base64");
  try {
    const actual = await scrypt(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    // Parameters scrypt refuses (a damaged hash): no match.
    return false;
  }
}

/** Spends the same time as a real check, so a missing account can't be told apart by timing. */
export async function verifyAgainstNothing(password: string): Promise<false> {
  await scrypt(password, randomBytes(16), N, R, P);
  return false;
}
