// Provider Hub adapts to what a provider offers. Each kind of service is a
// "workspace": a host with stays sees stays, a chef sees chef services, and a
// provider with several kinds sees each of them. Vehicle tools belong to the
// vehicles workspace only.
import type { ProviderCategory } from "./schema";

export type ProviderWorkspace = {
  key: ProviderCategory;
  label: string;
  // "2 stays", "1 vehicle"
  noun: [singular: string, plural: string];
  description: string;
  addLabel: string;
  addHref: string;
  bookingNoun: string;
};

export const providerWorkspaceOrder: ProviderCategory[] = ["stays", "cars", "cooks", "errands", "experiences"];

export const providerWorkspaces: Record<ProviderCategory, ProviderWorkspace> = {
  stays: {
    key: "stays",
    label: "Stays",
    noun: ["stay", "stays"],
    description: "Villas, apartments and homes",
    addLabel: "Add a stay",
    addHref: "/provider/stays/new",
    bookingNoun: "guest stays",
  },
  cars: {
    key: "cars",
    label: "Vehicles",
    noun: ["vehicle", "vehicles"],
    description: "Cars with a driver or self-drive",
    addLabel: "Add a vehicle",
    addHref: "/provider/cars/new",
    bookingNoun: "trips",
  },
  cooks: {
    key: "cooks",
    label: "Chef services",
    noun: ["chef service", "chef services"],
    description: "Private chefs and menus",
    addLabel: "Add a chef service",
    addHref: "/provider/cooks/new",
    bookingNoun: "meals",
  },
  errands: {
    key: "errands",
    label: "Home help",
    noun: ["home help service", "home help services"],
    description: "Cleaning, shopping, laundry and nannies",
    addLabel: "Add home help",
    addHref: "/provider/errands/new",
    bookingNoun: "visits",
  },
  experiences: {
    key: "experiences",
    label: "Experiences",
    noun: ["experience", "experiences"],
    description: "Boat trips, tours and days out",
    addLabel: "Add an experience",
    addHref: "/provider/experiences/new",
    bookingNoun: "outings",
  },
};

export type WorkspaceListingCounts = Partial<Record<ProviderCategory, number>>;

// The provider's workspaces: the kinds TBM set on their account, plus any kind
// they already manage a listing of. With neither (an admin, or an account TBM
// hasn't set up yet) every workspace shows, as before.
export function getProviderWorkspaceKeys(providerTypes: readonly string[] | null | undefined, listingCounts: WorkspaceListingCounts = {}): ProviderCategory[] {
  const assigned = new Set((providerTypes ?? []).filter((type): type is ProviderCategory => type in providerWorkspaces));
  for (const key of providerWorkspaceOrder) {
    if ((listingCounts[key] ?? 0) > 0) assigned.add(key);
  }
  return assigned.size ? providerWorkspaceOrder.filter((key) => assigned.has(key)) : [...providerWorkspaceOrder];
}

export function isProviderWorkspace(value: unknown): value is ProviderCategory {
  return typeof value === "string" && value in providerWorkspaces;
}

export function countNoun(count: number, workspace: ProviderCategory) {
  const [singular, plural] = providerWorkspaces[workspace].noun;
  return `${count} ${count === 1 ? singular : plural}`;
}

// Custom quotes only exist for chef menus and experience offers.
export function workspacesHaveCustomQuotes(keys: readonly ProviderCategory[]) {
  return keys.includes("cooks") || keys.includes("experiences");
}
