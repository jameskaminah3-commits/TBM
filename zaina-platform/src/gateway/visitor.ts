// zaina-platform/src/gateway/visitor.ts
//
// Who is asking, for rate limits: a keyed hash of the visitor's IP address.
// The address itself is never stored.

import { createHmac } from "node:crypto";

export function visitorKey(secret: string, ipAddress: string | undefined): string {
  const address = (ipAddress ?? "").trim().replace(/^::ffff:/, "") || "unknown";
  return createHmac("sha256", secret).update(`visitor:${address}`).digest("hex").slice(0, 32);
}
