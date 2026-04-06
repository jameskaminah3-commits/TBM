function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type VerificationPurpose = "email-verification" | "password-reset";

export function buildVerificationEmail(args: { code: string; purpose: VerificationPurpose }) {
  const isEmailVerification = args.purpose === "email-verification";
  const purposeLabel = isEmailVerification ? "email verification" : "password reset";
  const introLine = isEmailVerification
    ? "Use this code to verify your Tembea Bila Matata account."
    : "Use this code to reset your Tembea Bila Matata password.";
  const subject = `Your Tembea Bila Matata ${purposeLabel} code`;
  const text = [
    introLine,
    "",
    `Code: ${args.code}`,
    "",
    "This code expires in 10 minutes.",
    "If you did not request it, you can ignore this email.",
  ].join("\n");
  const html = [
    "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;\">",
    `<p>${escapeHtml(introLine)}</p>`,
    `<p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0;">${escapeHtml(args.code)}</p>`,
    "<p>This code expires in 10 minutes.</p>",
    "<p>If you did not request it, you can ignore this email.</p>",
    "</div>",
  ].join("");

  return { subject, text, html };
}
