// zaina-platform/src/channels/whatsapp/numbers.ts
//
// A business's connected WhatsApp number: which number, the follow-up
// template for replies after 24 hours, and its access token (an encrypted
// business secret, "whatsapp_access_token"). Kept inside the business; the
// webhook reaches a number's business through one database function that
// answers nothing else.

import { eq } from "drizzle-orm";
import { deleteSecret, getSecret, putSecret } from "../../businesses/secrets.ts";
import { appPool } from "../../db/platform-db.ts";
import { whatsappNumbers, type FollowupParameter, type WhatsappNumber } from "../../db/schema.ts";
import { inBusiness } from "../../db/tenant.ts";

export const ACCESS_TOKEN_SECRET = "whatsapp_access_token";

export type WhatsappConnection = WhatsappNumber & { accessToken: string };

/** The business a WhatsApp number belongs to, for the webhook (no business is in scope yet). */
export async function businessForNumber(phoneNumberId: string): Promise<string | null> {
  const { rows } = await appPool().query<{ business_id: string | null }>("select whatsapp_number_business($1) as business_id", [phoneNumberId]);
  return rows[0]?.business_id ?? null;
}

export async function getNumber(businessId: string): Promise<WhatsappNumber | null> {
  const [row] = await inBusiness((db) => db.select().from(whatsappNumbers).where(eq(whatsappNumbers.businessId, businessId)).limit(1), businessId);
  return row ?? null;
}

/** The number and its token, or null when the business hasn't connected WhatsApp (or it's paused). */
export async function connectionFor(businessId: string): Promise<WhatsappConnection | null> {
  const number = await getNumber(businessId);
  if (!number || number.status !== "active") return null;
  const accessToken = await getSecret(businessId, ACCESS_TOKEN_SECRET);
  return accessToken ? { ...number, accessToken } : null;
}

export type ConnectionInput = {
  phoneNumberId: string;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  followupTemplate: string | null;
  followupTemplateLanguage: string;
  followupTemplateParameter: FollowupParameter;
};

export async function saveConnection(businessId: string, input: ConnectionInput, accessToken: string | null, userId: string): Promise<WhatsappNumber> {
  const values = { ...input, status: "active" as const, connectedBy: userId, updatedAt: new Date() };
  const [row] = await inBusiness((db) => db
    .insert(whatsappNumbers)
    .values({ businessId, ...values })
    .onConflictDoUpdate({ target: whatsappNumbers.businessId, set: values })
    .returning(), businessId);
  if (accessToken) await putSecret(businessId, ACCESS_TOKEN_SECRET, accessToken, userId);
  return row;
}

export async function disconnect(businessId: string): Promise<boolean> {
  const rows = await inBusiness((db) => db.delete(whatsappNumbers).where(eq(whatsappNumbers.businessId, businessId)).returning(), businessId);
  await deleteSecret(businessId, ACCESS_TOKEN_SECRET);
  return rows.length > 0;
}
