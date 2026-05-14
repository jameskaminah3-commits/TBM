import assert from "node:assert/strict";
import test from "node:test";
import { getCanonicalRedirectUrl } from "./canonical-host.ts";

test("redirects the co.ke domain to the canonical .com domain", () => {
  const redirectUrl = getCanonicalRedirectUrl({
    canonicalBaseUrl: "https://tembeabilamatata.com",
    redirectHosts: ["tembeabilamatata.co.ke", "www.tembeabilamatata.co.ke"],
    requestHost: "tembeabilamatata.co.ke",
    requestPath: "/services/drive?city=nairobi",
  });

  assert.equal(redirectUrl, "https://tembeabilamatata.com/services/drive?city=nairobi");
});

test("does not redirect the canonical host", () => {
  const redirectUrl = getCanonicalRedirectUrl({
    canonicalBaseUrl: "https://tembeabilamatata.com",
    redirectHosts: ["tembeabilamatata.co.ke", "www.tembeabilamatata.co.ke"],
    requestHost: "tembeabilamatata.com",
    requestPath: "/",
  });

  assert.equal(redirectUrl, null);
});

test("does not redirect unrelated hosts", () => {
  const redirectUrl = getCanonicalRedirectUrl({
    canonicalBaseUrl: "https://tembeabilamatata.com",
    redirectHosts: ["tembeabilamatata.co.ke", "www.tembeabilamatata.co.ke"],
    requestHost: "api.example.com",
    requestPath: "/",
  });

  assert.equal(redirectUrl, null);
});
