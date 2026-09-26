// zaina-platform/src/payments/paystack.ts
//
// Paystack: card and M-Pesa payments into the business's own Paystack
// account (its secret key), or into its subaccount of the platform's account
// (the platform's key and the subaccount's code).
//
//   initialize   a hosted checkout for an amount; the customer is sent there
//   verify       what Paystack says about a payment, by our reference
//   webhooks     signed with HMAC-SHA512 of the raw body, keyed by the
//                account's secret key (x-paystack-signature)

import { createHmac, timingSafeEqual } from "node:crypto";

export const PAYSTACK_API = "https://api.paystack.co";

export type PaystackAccount = { secretKey: string; subaccount: string | null };

export type PaystackFailure = { ok: false; status: number; message: string };

async function call<T>(secretKey: string, method: "GET" | "POST", path: string, body?: unknown): Promise<{ ok: true; data: T } | PaystackFailure> {
  let response: Response;
  try {
    response = await fetch(`${PAYSTACK_API}${path}`, {
      method,
      headers: { authorization: `Bearer ${secretKey}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return { ok: false, status: 0, message: `Paystack didn't answer: ${(error as Error).message}` };
  }
  const payload = await response.json().catch(() => null) as { status?: boolean; message?: string; data?: T } | null;
  if (!response.ok || payload?.status !== true) {
    return { ok: false, status: response.status, message: payload?.message ?? `Paystack answered ${response.status}` };
  }
  return { ok: true, data: payload.data as T };
}

/** Whether a secret key works: Paystack answers with the account's balance. */
export async function checkSecretKey(secretKey: string): Promise<{ ok: true; live: boolean } | PaystackFailure> {
  if (!/^sk_(live|test)_[A-Za-z0-9]{10,100}$/.test(secretKey)) return { ok: false, status: 400, message: "A Paystack secret key starts with sk_live_ or sk_test_." };
  const result = await call<unknown>(secretKey, "GET", "/balance");
  return result.ok ? { ok: true, live: secretKey.startsWith("sk_live_") } : result;
}

/** Whether a subaccount exists on the platform's account, and its business name. */
export async function checkSubaccount(platformKey: string, code: string): Promise<{ ok: true; name: string } | PaystackFailure> {
  const result = await call<{ subaccount_code: string; business_name?: string; active?: boolean }>(platformKey, "GET", `/subaccount/${encodeURIComponent(code)}`);
  if (!result.ok) return result;
  if (result.data.active === false) return { ok: false, status: 400, message: "That subaccount isn't active." };
  return { ok: true, name: result.data.business_name ?? code };
}

export type Checkout = { authorizationUrl: string; reference: string };

export async function initializeCheckout(account: PaystackAccount, input: {
  email: string;
  amountMinor: number;
  currency: "KES" | "USD";
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
}): Promise<{ ok: true; checkout: Checkout } | PaystackFailure> {
  const result = await call<{ authorization_url: string; access_code: string; reference: string }>(account.secretKey, "POST", "/transaction/initialize", {
    email: input.email,
    amount: input.amountMinor,
    currency: input.currency,
    reference: input.reference,
    callback_url: input.callbackUrl,
    channels: input.currency === "KES" ? ["card", "mobile_money"] : ["card"],
    metadata: input.metadata,
    ...(account.subaccount ? { subaccount: account.subaccount } : {}),
  });
  if (!result.ok) return result;
  if (!/^https:\/\//.test(result.data.authorization_url ?? "")) return { ok: false, status: 502, message: "Paystack sent no checkout address." };
  return { ok: true, checkout: { authorizationUrl: result.data.authorization_url, reference: result.data.reference ?? input.reference } };
}

export type VerifiedTransaction = {
  status: "success" | "failed" | "abandoned" | "pending" | "ongoing" | "reversed" | string;
  amountMinor: number;
  currency: string;
  reference: string;
  id: string | null;
  channel: string | null;
  message: string | null;
};

function toTransaction(data: any): VerifiedTransaction {
  return {
    status: String(data?.status ?? ""),
    amountMinor: Number(data?.amount ?? 0),
    currency: String(data?.currency ?? ""),
    reference: String(data?.reference ?? ""),
    id: data?.id !== undefined && data?.id !== null ? String(data.id) : null,
    channel: data?.channel ? String(data.channel) : null,
    message: data?.gateway_response ? String(data.gateway_response) : null,
  };
}

export async function verifyTransaction(secretKey: string, reference: string): Promise<{ ok: true; transaction: VerifiedTransaction } | PaystackFailure> {
  const result = await call<unknown>(secretKey, "GET", `/transaction/verify/${encodeURIComponent(reference)}`);
  return result.ok ? { ok: true, transaction: toTransaction(result.data) } : result;
}

/** Whether a webhook came from Paystack, for the account with this secret key. */
export function validWebhookSignature(secretKey: string, rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

/** The transaction in a webhook's event, when it is a successful charge. */
export function chargeFromWebhook(body: unknown): VerifiedTransaction | null {
  const event = body as { event?: string; data?: unknown } | null;
  return event?.event === "charge.success" ? toTransaction(event.data) : null;
}
