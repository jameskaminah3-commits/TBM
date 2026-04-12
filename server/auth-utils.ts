import crypto from "crypto";

export function splitName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? null,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
  };
}

export function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, "");
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string | null) {
  if (!storedHash) {
    return false;
  }

  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) {
    return false;
  }

  const derived = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, "hex");
  if (derived.length !== stored.length) {
    return false;
  }

  return crypto.timingSafeEqual(derived, stored);
}

export function hashOtp(otp: string) {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

export function generateOneTimeCode() {
  return crypto.randomInt(100000, 999999).toString();
}

export function isLocalDevelopmentHostname(hostname: string | null | undefined) {
  const normalizedHostname = hostname?.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!normalizedHostname) {
    return false;
  }

  if (
    normalizedHostname === "localhost"
    || normalizedHostname.endsWith(".localhost")
    || normalizedHostname === "::1"
    || normalizedHostname.endsWith(".local")
    || /^127(?:\.\d{1,3}){3}$/.test(normalizedHostname)
    || /^10(?:\.\d{1,3}){3}$/.test(normalizedHostname)
    || /^192\.168(?:\.\d{1,3}){2}$/.test(normalizedHostname)
  ) {
    return true;
  }

  const privateRangeMatch = /^172\.(\d{1,3})(?:\.\d{1,3}){2}$/.exec(normalizedHostname);
  if (!privateRangeMatch) {
    return false;
  }

  const secondOctet = Number.parseInt(privateRangeMatch[1] ?? "", 10);
  return Number.isInteger(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
}

function isTruthyLocalFlag(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function shouldBypassOtpVerificationForLocalTesting(args: {
  nodeEnv?: string | null;
  hostname?: string | null;
  localOtpBypass?: string | null;
}) {
  if (isTruthyLocalFlag(args.localOtpBypass)) {
    return true;
  }

  if (args.nodeEnv?.trim().toLowerCase() === "production") {
    return false;
  }

  return isLocalDevelopmentHostname(args.hostname);
}
