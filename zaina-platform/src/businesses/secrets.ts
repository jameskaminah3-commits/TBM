// zaina-platform/src/businesses/secrets.ts
//
// A business's secrets (payment keys, messaging tokens, its own model key),
// encrypted with AES-256-GCM before they reach the database. The key comes
// from the environment and never touches the database. Each secret's
// business and name are bound into its encryption, so a ciphertext copied to
// another row fails to decrypt. Old keys stay readable during a key change:
// rows record which key encrypted them.
//
//   PLATFORM_SECRETS_KEY        32 bytes, base64 or hex: encrypts new secrets
//   PLATFORM_SECRETS_KEY_ID     its id (default "k1")
//   PLATFORM_SECRETS_OLD_KEYS   "id:key,id:key" still used to read older rows

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { businessSecrets } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";

export type SecretKeys = { currentId: string; keys: Map<string, Buffer> };

function parseKey(value: string, name: string): Buffer {
  const trimmed = value.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (key.length !== 32) throw new Error(`${name} must be 32 bytes, in base64 or hex`);
  return key;
}

export function loadSecretKeys(env: NodeJS.ProcessEnv = process.env): SecretKeys {
  const current = env.PLATFORM_SECRETS_KEY?.trim();
  if (!current) throw new Error("PLATFORM_SECRETS_KEY is required");
  const currentId = env.PLATFORM_SECRETS_KEY_ID?.trim() || "k1";
  const keys = new Map<string, Buffer>([[currentId, parseKey(current, "PLATFORM_SECRETS_KEY")]]);
  for (const entry of (env.PLATFORM_SECRETS_OLD_KEYS ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf(":");
    if (separator < 1) throw new Error("PLATFORM_SECRETS_OLD_KEYS entries look like id:key");
    keys.set(entry.slice(0, separator), parseKey(entry.slice(separator + 1), `PLATFORM_SECRETS_OLD_KEYS (${entry.slice(0, separator)})`));
  }
  return { currentId, keys };
}

let configured: SecretKeys | null = null;

export function setSecretKeys(keys: SecretKeys) {
  configured = keys;
}

function secretKeys(): SecretKeys {
  if (!configured) configured = loadSecretKeys();
  return configured;
}

export type SealedSecret = { ciphertext: Buffer; iv: Buffer; authTag: Buffer; keyId: string };

const binding = (businessId: string, name: string) => Buffer.from(`zaina-secret:${businessId}:${name}`);

export function sealSecret(keys: SecretKeys, businessId: string, name: string, plaintext: string): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys.keys.get(keys.currentId)!, iv);
  cipher.setAAD(binding(businessId, name));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag(), keyId: keys.currentId };
}

export function openSecret(keys: SecretKeys, businessId: string, name: string, sealed: SealedSecret): string {
  const key = keys.keys.get(sealed.keyId);
  if (!key) throw new Error(`Secret ${name} was encrypted with key "${sealed.keyId}", which isn't configured`);
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.iv);
  decipher.setAAD(binding(businessId, name));
  decipher.setAuthTag(sealed.authTag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8");
}

export const SECRET_NAME_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;

export async function putSecret(businessId: string, name: string, value: string, updatedBy: string | null): Promise<void> {
  if (!SECRET_NAME_PATTERN.test(name)) throw new Error("Secret names are lowercase letters, digits and underscores");
  if (!value || value.length > 8192) throw new Error("A secret is 1 to 8192 characters");
  const sealed = sealSecret(secretKeys(), businessId, name, value);
  await inBusiness((db) => db
    .insert(businessSecrets)
    .values({ businessId, name, ...sealed, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [businessSecrets.businessId, businessSecrets.name],
      set: { ...sealed, updatedBy, updatedAt: new Date() },
    }), businessId);
}

/** The secret's value, or null when the business hasn't set it. */
export async function getSecret(businessId: string, name: string): Promise<string | null> {
  const [row] = await inBusiness((db) => db
    .select()
    .from(businessSecrets)
    .where(and(eq(businessSecrets.businessId, businessId), eq(businessSecrets.name, name)))
    .limit(1), businessId);
  return row ? openSecret(secretKeys(), businessId, name, row) : null;
}

/** Which secrets are set, never their values. */
export async function listSecrets(businessId: string): Promise<Array<{ name: string; updatedAt: Date; updatedBy: string | null; keyId: string }>> {
  return inBusiness((db) => db
    .select({ name: businessSecrets.name, updatedAt: businessSecrets.updatedAt, updatedBy: businessSecrets.updatedBy, keyId: businessSecrets.keyId })
    .from(businessSecrets)
    .orderBy(asc(businessSecrets.name)), businessId);
}

export async function deleteSecret(businessId: string, name: string): Promise<boolean> {
  const rows = await inBusiness((db) => db
    .delete(businessSecrets)
    .where(and(eq(businessSecrets.businessId, businessId), eq(businessSecrets.name, name)))
    .returning({ name: businessSecrets.name }), businessId);
  return rows.length > 0;
}
