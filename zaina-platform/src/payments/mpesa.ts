// zaina-platform/src/payments/mpesa.ts
//
// M-Pesa Express (Safaricom's Daraja API, "STK push"): a payment prompt on
// the customer's phone, paid into the business's own paybill or till. The
// customer enters their M-Pesa PIN; Safaricom then calls the payment's
// callback address, and the result is confirmed by asking Safaricom again
// (stkQuery) before a booking is confirmed: a callback isn't signed.
//
// A paybill pays to its shortcode; a till ("buy goods") pays to the till
// number, with the store number as the shortcode.

export type MpesaAccount = {
  environment: "sandbox" | "production";
  type: "paybill" | "till";
  shortcode: string;
  till: string | null;
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
};

export const MPESA_API = { sandbox: "https://sandbox.safaricom.co.ke", production: "https://api.safaricom.co.ke" } as const;

export type MpesaFailure = { ok: false; status: number; message: string; code?: string };

/** "YYYYMMDDHHmmss" in Kenya time, as Daraja wants it. */
export function darajaTimestamp(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}${get("hour")}${get("minute")}${get("second")}`;
}

export const darajaPassword = (shortcode: string, passkey: string, timestamp: string) => Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");

/** A Kenyan mobile number as M-Pesa wants it (2547XXXXXXXX or 2541XXXXXXXX), or null. */
export function mpesaPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const local = digits.startsWith("254") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[17]\d{8}$/.test(local) ? `254${local}` : null;
}

// Access tokens last an hour; they are kept per account until shortly before.
const tokens = new Map<string, { token: string; until: number }>();

async function accessToken(account: MpesaAccount): Promise<{ ok: true; token: string } | MpesaFailure> {
  const key = `${account.environment}:${account.consumerKey}`;
  const cached = tokens.get(key);
  if (cached && cached.until > Date.now()) return { ok: true, token: cached.token };
  let response: Response;
  try {
    response = await fetch(`${MPESA_API[account.environment]}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { authorization: `Basic ${Buffer.from(`${account.consumerKey}:${account.consumerSecret}`).toString("base64")}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return { ok: false, status: 0, message: `M-Pesa didn't answer: ${(error as Error).message}` };
  }
  const payload = await response.json().catch(() => null) as { access_token?: string; expires_in?: string | number; errorMessage?: string } | null;
  if (!response.ok || !payload?.access_token) {
    return { ok: false, status: response.status, message: payload?.errorMessage ?? "M-Pesa refused the consumer key and secret." };
  }
  const seconds = Number(payload.expires_in ?? 3599) || 3599;
  tokens.set(key, { token: payload.access_token, until: Date.now() + (seconds - 60) * 1000 });
  return { ok: true, token: payload.access_token };
}

/** Whether the consumer key and secret work (Safaricom gives a token). */
export async function checkCredentials(account: MpesaAccount): Promise<{ ok: true } | MpesaFailure> {
  tokens.delete(`${account.environment}:${account.consumerKey}`);
  const token = await accessToken(account);
  return token.ok ? { ok: true } : token;
}

async function post<T>(account: MpesaAccount, path: string, body: unknown): Promise<{ ok: true; data: T } | MpesaFailure> {
  const token = await accessToken(account);
  if (!token.ok) return token;
  let response: Response;
  try {
    response = await fetch(`${MPESA_API[account.environment]}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    return { ok: false, status: 0, message: `M-Pesa didn't answer: ${(error as Error).message}` };
  }
  const payload = await response.json().catch(() => null) as (T & { errorCode?: string; errorMessage?: string }) | null;
  if (!response.ok || !payload) {
    if (response.status === 401) tokens.delete(`${account.environment}:${account.consumerKey}`);
    return { ok: false, status: response.status, message: payload?.errorMessage ?? `M-Pesa answered ${response.status}`, code: payload?.errorCode };
  }
  return { ok: true, data: payload };
}

/** Sends the payment prompt to the customer's phone; returns Safaricom's checkout request id. */
export async function stkPush(account: MpesaAccount, input: {
  phone: string;
  amount: number;
  reference: string;
  description: string;
  callbackUrl: string;
  now?: Date;
}): Promise<{ ok: true; checkoutRequestId: string; customerMessage: string | null } | MpesaFailure> {
  const timestamp = darajaTimestamp(input.now);
  const result = await post<{ CheckoutRequestID?: string; ResponseCode?: string; ResponseDescription?: string; CustomerMessage?: string }>(account, "/mpesa/stkpush/v1/processrequest", {
    BusinessShortCode: account.shortcode,
    Password: darajaPassword(account.shortcode, account.passkey, timestamp),
    Timestamp: timestamp,
    TransactionType: account.type === "till" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
    Amount: input.amount,
    PartyA: input.phone,
    PartyB: account.type === "till" ? account.till : account.shortcode,
    PhoneNumber: input.phone,
    CallBackURL: input.callbackUrl,
    AccountReference: input.reference.slice(0, 12),
    TransactionDesc: input.description.slice(0, 13),
  });
  if (!result.ok) return result;
  if (result.data.ResponseCode !== "0" || !result.data.CheckoutRequestID) {
    return { ok: false, status: 400, message: result.data.ResponseDescription ?? "M-Pesa didn't accept the request." };
  }
  return { ok: true, checkoutRequestId: result.data.CheckoutRequestID, customerMessage: result.data.CustomerMessage ?? null };
}

export type StkOutcome = { state: "paid" } | { state: "failed"; reason: string } | { state: "waiting" };

/** Asks Safaricom how a payment prompt ended. */
export async function stkQuery(account: MpesaAccount, checkoutRequestId: string, now?: Date): Promise<{ ok: true; outcome: StkOutcome } | MpesaFailure> {
  const timestamp = darajaTimestamp(now);
  const result = await post<{ ResponseCode?: string; ResultCode?: string | number; ResultDesc?: string }>(account, "/mpesa/stkpushquery/v1/query", {
    BusinessShortCode: account.shortcode,
    Password: darajaPassword(account.shortcode, account.passkey, timestamp),
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  });
  if (!result.ok) {
    // Still with the customer: Safaricom answers "being processed".
    if (result.code === "500.001.1001" || /being processed/i.test(result.message)) return { ok: true, outcome: { state: "waiting" } };
    return result;
  }
  const code = String(result.data.ResultCode ?? "");
  if (code === "0") return { ok: true, outcome: { state: "paid" } };
  if (code === "") return { ok: true, outcome: { state: "waiting" } };
  return { ok: true, outcome: { state: "failed", reason: result.data.ResultDesc ?? `M-Pesa result ${code}` } };
}

export type StkCallback = {
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  amount: number | null;
  receipt: string | null;
  phone: string | null;
};

/** Safaricom's callback body, read. */
export function readStkCallback(body: unknown): StkCallback | null {
  const callback = (body as { Body?: { stkCallback?: any } } | null)?.Body?.stkCallback;
  if (!callback || typeof callback.CheckoutRequestID !== "string") return null;
  const items: Array<{ Name?: string; Value?: unknown }> = Array.isArray(callback.CallbackMetadata?.Item) ? callback.CallbackMetadata.Item : [];
  const item = (name: string) => items.find((entry) => entry.Name === name)?.Value;
  const receipt = item("MpesaReceiptNumber");
  const phone = item("PhoneNumber");
  const amount = Number(item("Amount"));
  return {
    checkoutRequestId: callback.CheckoutRequestID,
    resultCode: Number(callback.ResultCode),
    resultDesc: String(callback.ResultDesc ?? ""),
    amount: Number.isFinite(amount) && item("Amount") !== undefined ? amount : null,
    receipt: typeof receipt === "string" && /^[A-Z0-9]{8,12}$/.test(receipt) ? receipt : null,
    phone: phone !== undefined && phone !== null ? String(phone) : null,
  };
}

/** An M-Pesa confirmation code as customers type it ("qk12abc34d" → "QK12ABC34D"), or null. */
export function mpesaCode(input: string): string | null {
  const code = input.trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z][A-Z0-9]{9}$/.test(code) && /\d/.test(code) ? code : null;
}
