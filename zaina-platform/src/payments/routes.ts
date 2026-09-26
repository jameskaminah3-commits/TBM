// zaina-platform/src/payments/routes.ts
//
// Paying for a booking, and hearing back from the payment providers:
//
//   GET  /pay/:token                 the booking's payment page
//   POST /pay/:token/paystack        card or M-Pesa on Paystack's page (redirects there)
//   GET  /pay/:token/done            back from Paystack: ask how it went
//   POST /pay/:token/mpesa           a payment prompt on the customer's phone
//   POST /pay/:token/mpesa-code      an M-Pesa code, for the team to check
//   GET  /pay/:token/status          where the booking stands (JSON)
//   GET  /pay-assets/pay.css         the page's styles
//
//   POST /v1/payments/paystack/:businessId   Paystack's webhook, for a business's own account
//   POST /v1/payments/paystack               Paystack's webhook, for the platform's account (subaccounts)
//   POST /v1/payments/mpesa/:token           Safaricom's callback for one payment prompt
//
// The token in a booking's link is the only key to its page: whoever has
// the link can see the booking and pay it. Payments are rate-limited per
// booking and per visitor, so a link can't be used to flood a phone with
// payment prompts.

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { getBusinessSettings } from "../businesses/settings.ts";
import { connectorFor } from "../connectors/registry.ts";
import { offerings, type Booking, type Business, type Payment } from "../db/schema.ts";
import { inBusiness, runForBusiness } from "../db/tenant.ts";
import { consumeLimits } from "../gateway/rate-limit.ts";
import { visitorKey } from "../gateway/visitor.ts";
import { paymentsOf } from "../booking/bookings.ts";
import { getBookingSettings, paymentOptionsOf } from "../booking/settings.ts";
import { and, eq } from "drizzle-orm";
import {
  amountDue,
  bookingForPage,
  checkMpesaPayment,
  checkPaystackReturn,
  handleMpesaCallback,
  handlePaystackWebhook,
  startMpesaExpress,
  startPaystack,
  submitMpesaCode,
} from "./checkout.ts";
import { mpesaCode } from "./mpesa.ts";
import { PAY_CSS } from "./page-css.ts";
import { PAGE_MESSAGES, renderPayPage } from "./page.ts";

/** Paystack's webhooks need their raw body: the JSON parser leaves these paths alone. */
export const PAYMENT_WEBHOOK_PATH = /^\/v1\/payments\/paystack(\/[a-z][a-z0-9-]{1,39})?$/;

const PAGE_CSP = [
  "default-src 'none'",
  "style-src 'self'",
  "img-src 'self' data:",
  // A form posts here, then goes on to Paystack's checkout.
  "form-action 'self' https://checkout.paystack.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

function pageHeaders(res: Response) {
  res.setHeader("Content-Security-Policy", PAGE_CSP);
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
}

const NOT_FOUND_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Booking not found</title><link rel="stylesheet" href="/pay-assets/pay.css"><link rel="icon" href="data:,"></head><body><main class="pay"><h1>Booking not found</h1><p>This booking link isn't valid. Please check the link you were sent, or ask the business for a new one.</p></main></body></html>`;

/** The payment the customer is in the middle of, if any, and their last failure. */
function paymentState(list: Payment[], now: Date, returned: boolean): { pending: Payment | null; lastFailure: Payment | null } {
  const pending = list.find((payment) => payment.status === "pending" && (
    payment.method === "mpesa_code"
    || (payment.method === "mpesa_express" && now.getTime() - payment.createdAt.getTime() < 5 * 60_000)
    || (payment.method === "paystack" && returned && now.getTime() - payment.createdAt.getTime() < 10 * 60_000)
  )) ?? null;
  const latest = list[0];
  const lastFailure = latest && latest.status === "failed" && latest.settledAt && now.getTime() - latest.settledAt.getTime() < 30 * 60_000 ? latest : null;
  return { pending, lastFailure };
}

async function offeringName(business: Business, booking: Booking): Promise<string> {
  const [row] = await inBusiness((db) => db.select({ name: offerings.name }).from(offerings)
    .where(and(eq(offerings.businessId, business.id), eq(offerings.id, booking.offeringId))).limit(1), business.id);
  return row?.name ?? "Room";
}

export function registerPaymentRoutes(app: Express, config: PlatformConfig): void {
  const secret = config.sessionTokenSecret;
  const form = express.urlencoded({ extended: false, limit: "4kb" });
  const host = (req: Request) => (config.publicBaseUrl ? new URL(config.publicBaseUrl).host : req.get("host") ?? "");

  app.get("/pay-assets/pay.css", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/css; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(PAY_CSS);
  });

  /** Runs a page handler for the booking behind the token, in its business's scope. */
  const withBooking = (handler: (req: Request, res: Response, found: { business: Business; booking: Booking }) => Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        pageHeaders(res);
        const found = await bookingForPage(String(req.params.token ?? ""));
        if (!found) {
          res.status(404).type("html").send(NOT_FOUND_PAGE);
          return;
        }
        await runForBusiness(found.business.id, () => handler(req, res, found));
      } catch (error) {
        next(error);
      }
    };

  const back = (res: Response, token: string, query: string) => res.redirect(303, `/pay/${encodeURIComponent(token)}${query ? `?${query}` : ""}`);

  /** Limits payment attempts per booking and per visitor; false (and redirected) when over. */
  async function allowed(req: Request, res: Response, booking: Booking, extra: Array<{ key: string; limit: number; windowSeconds: number }> = []): Promise<boolean> {
    const verdict = await consumeLimits([
      { key: `pay:booking:${booking.id}`, limit: 12, windowSeconds: 600 },
      { key: `pay:visitor:${visitorKey(secret, req.ip)}`, limit: 40, windowSeconds: 3600 },
      ...extra,
    ]);
    if (!verdict.allowed) back(res, booking.payToken, "m=too_many");
    return verdict.allowed;
  }

  app.get("/pay/:token", withBooking(async (req, res, { business, booking }) => {
    const now = new Date();
    let list = await paymentsOf(business.id, booking.id);
    let current = booking;
    // A prompt still waiting: ask Safaricom, in case its callback went astray.
    const prompt = list.find((payment) => payment.status === "pending" && payment.method === "mpesa_express");
    if (prompt) {
      await checkMpesaPayment(business, prompt);
      list = await paymentsOf(business.id, booking.id);
      current = (await bookingForPage(booking.payToken))?.booking ?? booking;
    }
    const { pending, lastFailure } = paymentState(list, now, req.query.returned === "1");
    const [settings, policy, connector] = await Promise.all([getBusinessSettings(business.id), getBookingSettings(business.id), connectorFor(business)]);
    const message = typeof req.query.m === "string" && req.query.m in PAGE_MESSAGES ? req.query.m : null;
    res.type("html").send(renderPayPage({
      businessName: settings?.displayName ?? business.name,
      offeringName: await offeringName(business, current),
      booking: current,
      settings: policy,
      options: paymentOptionsOf(policy),
      due: amountDue(current),
      pending,
      lastFailure,
      message,
      contactLine: await connector.contactLine(business),
      timeZone: business.timeZone,
      now,
      host: host(req),
      token: booking.payToken,
    }));
  }));

  app.get("/pay/:token/status", withBooking(async (_req, res, { business, booking }) => {
    const list = await paymentsOf(business.id, booking.id);
    res.json({
      reference: booking.reference,
      status: booking.status,
      hold_expires_at: booking.holdExpiresAt,
      total_minor: booking.totalMinor,
      deposit_minor: booking.depositMinor,
      paid_minor: booking.paidMinor,
      due_minor: amountDue(booking),
      currency: booking.currency,
      payments: list.map((payment) => ({ method: payment.method, status: payment.status, amount_minor: payment.amountMinor, created_at: payment.createdAt })),
    });
  }));

  app.post("/pay/:token/paystack", form, withBooking(async (req, res, { business, booking }) => {
    if (!(await allowed(req, res, booking))) return;
    const started = await startPaystack(business, booking, { email: typeof req.body?.email === "string" ? req.body.email : null });
    if (!started.ok) return back(res, booking.payToken, `m=${started.code}`);
    res.redirect(303, started.redirect!);
  }));

  app.get("/pay/:token/done", withBooking(async (req, res, { business, booking }) => {
    const reference = typeof req.query.reference === "string" ? req.query.reference : typeof req.query.trxref === "string" ? req.query.trxref : "";
    if (reference && /^zb_[0-9a-f]{24}$/.test(reference)) await checkPaystackReturn(business, booking, reference);
    back(res, booking.payToken, "returned=1");
  }));

  app.post("/pay/:token/mpesa", form, withBooking(async (req, res, { business, booking }) => {
    if (!(await allowed(req, res, booking, [{ key: `pay:prompt:${booking.id}`, limit: 3, windowSeconds: 600 }]))) return;
    const started = await startMpesaExpress(business, booking, { phone: typeof req.body?.phone === "string" ? req.body.phone : "" });
    back(res, booking.payToken, started.ok ? "m=sent" : `m=${started.code}`);
  }));

  app.post("/pay/:token/mpesa-code", form, withBooking(async (req, res, { business, booking }) => {
    if (!(await allowed(req, res, booking))) return;
    const code = mpesaCode(typeof req.body?.code === "string" ? req.body.code : "");
    if (!code) return back(res, booking.payToken, "m=code_invalid");
    const result = await submitMpesaCode(business, booking, code);
    if (!result.ok) return back(res, booking.payToken, `m=${result.reason === "used" ? "code_used" : result.reason === "nothing_due" ? "nothing_due" : "not_available"}`);
    back(res, booking.payToken, "m=code");
  }));

  // ── Providers ─────────────────────────────────────────────────────────
  const raw = express.raw({ type: () => true, limit: "256kb" });
  const paystackWebhook = (businessId: string | null) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const valid = await handlePaystackWebhook(businessId, body, req.header("x-paystack-signature") ?? undefined);
      res.status(valid ? 200 : 401).json({ ok: valid });
    } catch (error) {
      next(error);
    }
  };
  app.post("/v1/payments/paystack/:businessId", raw, (req: Request, res: Response, next: NextFunction) => paystackWebhook(String(req.params.businessId))(req, res, next));
  app.post("/v1/payments/paystack", raw, paystackWebhook(null));

  app.post("/v1/payments/mpesa/:token", express.json({ limit: "64kb" }), async (req: Request, res: Response) => {
    // Safaricom only needs to hear it arrived; the result is checked with Safaricom before it counts.
    try {
      await handleMpesaCallback(String(req.params.token ?? ""), req.body);
    } catch (error) {
      console.error("[payments] M-Pesa callback failed:", error);
    }
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  });
}
