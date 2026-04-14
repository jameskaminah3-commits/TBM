import crypto from "crypto";
import type { Booking, BookingPaymentStatus, CustomerPaymentMethod, CustomerPaymentProvider } from "@shared/schema";

const BOOKING_PAYMENT_HOLD_MINUTES = 30;
const PAYSTACK_API_BASE_URL = "https://api.paystack.co";

const PESAPAL_ENV = process.env.PESAPAL_ENV === "live" ? "live" : "sandbox";
const PESAPAL_API_BASE_URL = PESAPAL_ENV === "live"
  ? "https://pay.pesapal.com/v3/api"
  : "https://cybqa.pesapal.com/pesapalv3/api";

type PaystackInitializeResponse = {
  status?: boolean;
  message?: string;
  data?: {
    authorization_url?: string;
    access_code?: string;
    reference?: string;
  };
};

type PaystackVerifyResponse = {
  status?: boolean;
  message?: string;
  data?: {
    amount?: number;
    currency?: string;
    paid_at?: string;
    reference?: string;
    status?: string;
    gateway_response?: string;
  };
};

type PesapalTokenResponse = {
  token?: string;
  expiryDate?: string;
  error?: { message?: string | null } | null;
};

type PesapalRegisterIpnResponse = {
  ipn_id?: string;
  status?: string;
  error?: { message?: string | null } | null;
};

type PesapalSubmitOrderResponse = {
  order_tracking_id?: string;
  merchant_reference?: string;
  redirect_url?: string;
  status?: string;
  error?: { message?: string | null } | null;
};

type PesapalTransactionStatusResponse = {
  payment_method?: string;
  amount?: number;
  created_date?: string;
  confirmation_code?: string;
  payment_status_description?: string;
  description?: string;
  message?: string;
  currency?: string;
  merchant_reference?: string;
  status?: string;
};

type RequestLike = {
  protocol: string;
  get(name: string): string | undefined;
};

export type HostedCheckoutSession = {
  provider: CustomerPaymentProvider;
  reference: string;
  sessionId: string | null;
  redirectUrl: string;
  currency: "USD" | "KES";
  amount: number;
  holdExpiresAt: string;
};

export type VerifiedHostedPayment = {
  provider: CustomerPaymentProvider;
  reference: string;
  sessionId: string | null;
  status: BookingPaymentStatus;
  currency: string;
  amount: number | null;
  paidAt: string | null;
  message: string | null;
  rawStatus: string | null;
};

function normalizePositiveMoney(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

let pesapalTokenCache: { token: string; expiresAt: number } | null = null;
let pesapalIpnCache: { baseUrl: string; ipnId: string } | null = null;

function getPaymentHoldExpiresAt() {
  return new Date(Date.now() + (BOOKING_PAYMENT_HOLD_MINUTES * 60 * 1000)).toISOString();
}

function ensurePaystackSecretKey() {
  const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("Paystack is not configured yet. Add PAYSTACK_SECRET_KEY on the server.");
  }
  return secretKey;
}

function hasPaystackSecretKey() {
  return !!process.env.PAYSTACK_SECRET_KEY?.trim();
}

function ensurePesapalCredentials() {
  const consumerKey = process.env.PESAPAL_CONSUMER_KEY?.trim();
  const consumerSecret = process.env.PESAPAL_CONSUMER_SECRET?.trim();
  if (!consumerKey || !consumerSecret) {
    throw new Error("Pesapal is not configured yet. Add PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET on the server.");
  }
  return { consumerKey, consumerSecret };
}

function hasPesapalCredentials() {
  return !!process.env.PESAPAL_CONSUMER_KEY?.trim() && !!process.env.PESAPAL_CONSUMER_SECRET?.trim();
}

function splitGuestName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return { firstName: "Tembea", lastName: "Guest" };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "Guest" };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function sanitizePhoneNumber(phone: string | null | undefined) {
  return phone?.replace(/[^\d+]/g, "").trim() || undefined;
}

function normalizeResponseError(message: string | null | undefined, fallback: string) {
  return message?.trim() || fallback;
}

async function readJsonSafe<T>(response: Response) {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

export function getApplicationBaseUrl(req: RequestLike) {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const host = req.get("host");
  if (!host) {
    throw new Error("Could not determine the application base URL for payment callbacks.");
  }

  return `${req.protocol}://${host}`;
}

function compactBookingId(bookingId: string) {
  return bookingId.replace(/-/g, "");
}

function expandBookingId(compactId: string) {
  if (!/^[a-f0-9]{32}$/i.test(compactId)) {
    return null;
  }

  const normalized = compactId.toLowerCase();
  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20),
  ].join("-");
}

export function buildBookingPaymentReference(provider: CustomerPaymentProvider, bookingId: string) {
  const providerCode = provider === "paystack" ? "ps" : "pp";
  return `tm-${providerCode}-${compactBookingId(bookingId)}-${Date.now().toString(36)}`;
}

export function getBookingIdFromPaymentReference(reference: string) {
  const match = /^tm-(?:ps|pp)-([a-f0-9]{32})-/i.exec(reference.trim());
  return match ? expandBookingId(match[1]) : null;
}

function mapPaystackStatus(status?: string | null): BookingPaymentStatus {
  switch ((status || "").toLowerCase()) {
    case "success":
      return "paid";
    case "abandoned":
      return "cancelled";
    case "failed":
      return "failed";
    case "reversed":
      return "refunded";
    case "ongoing":
    case "pending":
    case "processing":
      return "processing";
    default:
      return "pending";
  }
}

function mapPesapalStatus(status?: string | null): BookingPaymentStatus {
  switch ((status || "").toUpperCase()) {
    case "COMPLETED":
      return "paid";
    case "FAILED":
    case "INVALID":
      return "failed";
    case "REVERSED":
      return "refunded";
    default:
      return "pending";
  }
}

async function getPesapalBearerToken() {
  if (pesapalTokenCache && pesapalTokenCache.expiresAt > Date.now()) {
    return pesapalTokenCache.token;
  }

  const credentials = ensurePesapalCredentials();
  const response = await fetch(`${PESAPAL_API_BASE_URL}/Auth/RequestToken`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      consumer_key: credentials.consumerKey,
      consumer_secret: credentials.consumerSecret,
    }),
  });
  const payload = await readJsonSafe<PesapalTokenResponse>(response);

  if (!response.ok || !payload?.token) {
    throw new Error(normalizeResponseError(payload?.error?.message, "Pesapal authentication failed."));
  }

  const expiresAt = payload.expiryDate
    ? new Date(payload.expiryDate).getTime() - (60 * 1000)
    : Date.now() + (50 * 60 * 1000);
  pesapalTokenCache = { token: payload.token, expiresAt };
  return payload.token;
}

async function getPesapalNotificationId(baseUrl: string) {
  const ipnUrl = `${baseUrl}/api/payments/webhooks/pesapal`;

  if (process.env.PESAPAL_IPN_ID?.trim()) {
    return process.env.PESAPAL_IPN_ID.trim();
  }

  if (pesapalIpnCache?.baseUrl === ipnUrl) {
    return pesapalIpnCache.ipnId;
  }

  const token = await getPesapalBearerToken();
  const response = await fetch(`${PESAPAL_API_BASE_URL}/URLSetup/RegisterIPN`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: ipnUrl,
      ipn_notification_type: "GET",
    }),
  });
  const payload = await readJsonSafe<PesapalRegisterIpnResponse>(response);

  if (!response.ok || !payload?.ipn_id) {
    throw new Error(normalizeResponseError(payload?.error?.message, "Pesapal IPN registration failed."));
  }

  pesapalIpnCache = {
    baseUrl: ipnUrl,
    ipnId: payload.ipn_id,
  };

  return payload.ipn_id;
}

async function createPaystackCheckoutSession(
  booking: Pick<Booking, "id" | "guestEmail" | "guestName" | "guestPhone" | "totalPrice">,
  baseUrl: string,
  paymentMethod: CustomerPaymentMethod,
  usdToKes: number,
  amountUsd: number,
): Promise<HostedCheckoutSession> {
  const secretKey = ensurePaystackSecretKey();
  const reference = buildBookingPaymentReference("paystack", booking.id);
  const callbackUrl = `${baseUrl}/api/payments/callback/paystack`;
  const channels = paymentMethod === "mpesa"
    ? ["mobile_money"]
    : ["card", "apple_pay"];
  const currency = paymentMethod === "mpesa" ? "KES" : "USD";
  const amount = paymentMethod === "mpesa"
    ? Math.max(300, Math.round(amountUsd * usdToKes * 100))
    : Math.max(100, Math.round(amountUsd * 100));
  const response = await fetch(`${PAYSTACK_API_BASE_URL}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: booking.guestEmail,
      amount,
      currency,
      reference,
      callback_url: callbackUrl,
      channels,
      metadata: {
        bookingId: booking.id,
        guestName: booking.guestName,
        guestPhone: sanitizePhoneNumber(booking.guestPhone),
        requestedPaymentMethod: paymentMethod,
        requestedAmountUsd: amountUsd,
      },
    }),
  });
  const payload = await readJsonSafe<PaystackInitializeResponse>(response);

  if (!response.ok || !payload?.data?.authorization_url || !payload.data.reference) {
    throw new Error(normalizeResponseError(payload?.message, "Paystack checkout could not be started."));
  }

  return {
    provider: "paystack",
    reference: payload.data.reference,
    sessionId: payload.data.access_code ?? null,
    redirectUrl: payload.data.authorization_url,
    currency,
    amount: currency === "KES"
      ? Math.max(1, Math.round(amountUsd * usdToKes))
      : Math.max(1, Math.round(amountUsd)),
    holdExpiresAt: getPaymentHoldExpiresAt(),
  };
}

async function createPesapalCheckoutSession(
  booking: Pick<Booking, "id" | "guestEmail" | "guestName" | "guestPhone" | "totalPrice">,
  baseUrl: string,
  usdToKes: number,
  amountUsd: number,
): Promise<HostedCheckoutSession> {
  const token = await getPesapalBearerToken();
  const reference = buildBookingPaymentReference("pesapal", booking.id);
  const notificationId = await getPesapalNotificationId(baseUrl);
  const { firstName, lastName } = splitGuestName(booking.guestName);
  const amountKes = Math.max(1, Math.round(amountUsd * usdToKes));
  const response = await fetch(`${PESAPAL_API_BASE_URL}/Transactions/SubmitOrderRequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: reference,
      currency: "KES",
      amount: amountKes,
      description: `Tembea order ${booking.id.slice(0, 8).toUpperCase()}`,
      callback_url: `${baseUrl}/api/payments/callback/pesapal`,
      cancellation_url: `${baseUrl}/bookings?payment=cancelled&bookingId=${booking.id}`,
      notification_id: notificationId,
      redirect_mode: "TOP_WINDOW",
      branch: "TembeaBilaMatata",
      billing_address: {
        email_address: booking.guestEmail,
        phone_number: sanitizePhoneNumber(booking.guestPhone),
        country_code: "KE",
        first_name: firstName,
        last_name: lastName,
      },
    }),
  });
  const payload = await readJsonSafe<PesapalSubmitOrderResponse>(response);

  if (!response.ok || !payload?.redirect_url || !payload?.merchant_reference) {
    throw new Error(normalizeResponseError(payload?.error?.message, "Pesapal checkout could not be started."));
  }

  return {
    provider: "pesapal",
    reference: payload.merchant_reference,
    sessionId: payload.order_tracking_id ?? null,
    redirectUrl: payload.redirect_url,
    currency: "KES",
    amount: amountKes,
    holdExpiresAt: getPaymentHoldExpiresAt(),
  };
}

export async function createHostedCheckoutSession(args: {
  paymentMethod: CustomerPaymentMethod;
  booking: Pick<Booking, "id" | "guestEmail" | "guestName" | "guestPhone" | "totalPrice">;
  baseUrl: string;
  usdToKes: number;
  amountUsd?: number;
}) {
  const amountUsd = Math.max(0, Math.round(args.amountUsd ?? args.booking.totalPrice));

  if (hasPaystackSecretKey()) {
    try {
      return await createPaystackCheckoutSession(args.booking, args.baseUrl, args.paymentMethod, args.usdToKes, amountUsd);
    } catch (paystackError) {
      if (!hasPesapalCredentials()) {
        throw paystackError;
      }

      console.error("[PAYMENTS] Paystack checkout failed. Falling back to Pesapal:", paystackError);
    }
  }

  if (hasPesapalCredentials()) {
    return await createPesapalCheckoutSession(args.booking, args.baseUrl, args.usdToKes, amountUsd);
  }

  if (!hasPaystackSecretKey()) {
    throw new Error("Payments are not configured yet. Add PAYSTACK_SECRET_KEY, and optionally Pesapal fallback keys.");
  }

  throw new Error("Paystack checkout could not be started, and Pesapal fallback is not configured.");
}

export function verifyPaystackWebhookSignature(rawBody: Buffer | null | undefined, signature: string | null | undefined) {
  if (!rawBody || !signature) {
    return false;
  }

  const digest = crypto
    .createHmac("sha512", ensurePaystackSecretKey())
    .update(rawBody)
    .digest("hex");

  return digest === signature;
}

export async function verifyPaystackPayment(reference: string): Promise<VerifiedHostedPayment> {
  const secretKey = ensurePaystackSecretKey();
  const response = await fetch(`${PAYSTACK_API_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  });
  const payload = await readJsonSafe<PaystackVerifyResponse>(response);

  if (!response.ok || !payload?.data?.reference) {
    throw new Error(normalizeResponseError(payload?.message, "Could not verify the Paystack payment."));
  }

  return {
    provider: "paystack",
    reference: payload.data.reference,
    sessionId: null,
    status: mapPaystackStatus(payload.data.status),
    currency: payload.data.currency ?? "USD",
    amount: typeof payload.data.amount === "number"
      ? Math.max(1, Math.round(payload.data.amount / 100))
      : null,
    paidAt: payload.data.paid_at ?? null,
    message: payload.data.gateway_response ?? payload.message ?? null,
    rawStatus: payload.data.status ?? null,
  };
}

export function getVerifiedPaymentCheckoutAmount(
  booking: Pick<Booking, "paymentReference" | "paymentProvider" | "paymentCurrency" | "paymentAmount" | "paymentCheckoutAmount">,
  verifiedPayment: Pick<VerifiedHostedPayment, "provider" | "reference" | "currency" | "amount">,
) {
  if (!booking.paymentReference || booking.paymentReference !== verifiedPayment.reference) {
    return null;
  }

  if (booking.paymentProvider && booking.paymentProvider !== verifiedPayment.provider) {
    return null;
  }

  const verifiedAmount = normalizePositiveMoney(verifiedPayment.amount);
  if (verifiedAmount <= 0) {
    return null;
  }

  if (verifiedPayment.currency === "USD") {
    return verifiedAmount;
  }

  if (booking.paymentCurrency !== verifiedPayment.currency) {
    return null;
  }

  const expectedProviderAmount = normalizePositiveMoney(booking.paymentAmount);
  const expectedCheckoutAmount = normalizePositiveMoney(booking.paymentCheckoutAmount);
  if (expectedProviderAmount <= 0 || expectedCheckoutAmount <= 0) {
    return null;
  }

  const settledRatio = Math.min(1, verifiedAmount / expectedProviderAmount);
  return Math.max(0, Math.round(expectedCheckoutAmount * settledRatio));
}

export async function verifyPesapalPayment(orderTrackingId: string): Promise<VerifiedHostedPayment> {
  const token = await getPesapalBearerToken();
  const url = `${PESAPAL_API_BASE_URL}/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const payload = await readJsonSafe<PesapalTransactionStatusResponse>(response);

  if (!response.ok || !payload?.merchant_reference) {
    throw new Error(normalizeResponseError(payload?.message, "Could not verify the Pesapal payment."));
  }

  return {
    provider: "pesapal",
    reference: payload.merchant_reference,
    sessionId: orderTrackingId,
    status: mapPesapalStatus(payload.payment_status_description),
    currency: payload.currency ?? "KES",
    amount: typeof payload.amount === "number" ? Math.max(1, Math.round(payload.amount)) : null,
    paidAt: payload.created_date ?? null,
    message: payload.description ?? payload.message ?? null,
    rawStatus: payload.payment_status_description ?? null,
  };
}
