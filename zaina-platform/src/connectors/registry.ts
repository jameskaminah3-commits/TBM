// zaina-platform/src/connectors/registry.ts
//
// Which connector serves which business. The server registers the connectors
// it runs at start-up (TBM's, when TBM's database is configured); tests
// register scripted ones. Any other business gets the basic connector:
// answers from its settings, and leads for its team.

import { basicConnector } from "./basic/index.ts";
import type { BusinessConnector } from "./types.ts";

const connectors = new Map<string, BusinessConnector>();
// Businesses that must have their own connector (TBM): never the basic one.
const expected = new Set<string>();

/** Marks a business as needing its own connector: without it, its chats fail instead of falling back. */
export function expectConnector(businessId: string): void {
  expected.add(businessId);
}

export function registerConnector(businessId: string, connector: BusinessConnector): void {
  connectors.set(businessId, connector);
}

export function hasConnector(businessId: string): boolean {
  return connectors.has(businessId);
}

export async function connectorFor(businessId: string): Promise<BusinessConnector> {
  const connector = connectors.get(businessId);
  if (connector) return connector;
  if (expected.has(businessId)) throw new Error(`The connector for "${businessId}" isn't configured on this server`);
  return basicConnector;
}
