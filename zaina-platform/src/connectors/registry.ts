// zaina-platform/src/connectors/registry.ts
//
// Which connector serves which business. The server registers the connectors
// it runs at start-up (TBM's, when TBM's database is configured); tests
// register scripted ones.

import type { BusinessConnector } from "./types.ts";

const connectors = new Map<string, BusinessConnector>();

export function registerConnector(businessId: string, connector: BusinessConnector): void {
  connectors.set(businessId, connector);
}

export function hasConnector(businessId: string): boolean {
  return connectors.has(businessId);
}

export async function connectorFor(businessId: string): Promise<BusinessConnector> {
  const connector = connectors.get(businessId);
  if (!connector) throw new Error(`No connector for business "${businessId}" on this server`);
  return connector;
}
