// zaina-platform/src/connectors/registry.ts
//
// Which connector serves which business. The server registers the connectors
// it runs at start-up (TBM's, when TBM's database is configured); tests
// register scripted ones. Any other business gets the platform's own
// connector for its type: a place to stay gets rooms and bookings
// (hospitality), a salon or restaurant gets time slots (appointments), and
// anything else answers from its settings and takes leads for its team
// (basic).

import { booksTime, type Business } from "../db/schema.ts";
import { appointmentsConnector } from "./appointments/index.ts";
import { basicConnector } from "./basic/index.ts";
import { hospitalityConnector } from "./hospitality/index.ts";
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

export async function connectorFor(business: Pick<Business, "id" | "businessType">): Promise<BusinessConnector> {
  const connector = connectors.get(business.id);
  if (connector) return connector;
  if (expected.has(business.id)) throw new Error(`The connector for "${business.id}" isn't configured on this server`);
  if (business.businessType === "guesthouse") return hospitalityConnector;
  if (booksTime(business.businessType)) return appointmentsConnector;
  return basicConnector;
}
