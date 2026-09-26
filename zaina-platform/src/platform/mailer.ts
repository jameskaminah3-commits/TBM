// zaina-platform/src/platform/mailer.ts
//
// Emails the platform itself sends (confirming a new account, a sign-up for
// an email that already has one), through the same provider as staff alerts
// (Resend: RESEND_API_KEY and ALERT_FROM_EMAIL).

import type { AlertEmailConfig } from "../config.ts";

let config: AlertEmailConfig | null = null;

export function configureMailer(next: AlertEmailConfig | null) {
  config = next;
}

export const mailerConfigured = () => config !== null;

/** Sends one plain-text email. False (and logged) when it couldn't be sent. */
export async function sendEmail(input: { to: string; subject: string; text: string }): Promise<boolean> {
  if (!config) {
    console.warn("[mailer] no email provider is configured: an email wasn't sent");
    return false;
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${config.resendApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config.from, to: [input.to], subject: input.subject, text: input.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) console.warn(`[mailer] email refused (${response.status})`);
    return response.ok;
  } catch (error) {
    console.error("[mailer] email failed:", (error as Error).message);
    return false;
  }
}
