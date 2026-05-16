import React, { createContext, useContext, useState } from "react";
import type { Car, Cook, Errand, Experience, Stay } from "@shared/schema";

export type ConciergeSection = "stays" | "drive" | "dine" | "relax" | "experience";

type ConciergeSearchContextValue = {
  query: string;
  setQuery: (value: string) => void;
  clearQuery: () => void;
};

const ConciergeSearchContext = createContext<ConciergeSearchContextValue | null>(null);

const sectionRoutes: Record<ConciergeSection, string> = {
  stays: "/accommodations",
  drive: "/services/drive",
  dine: "/services/dine",
  relax: "/services/relax",
  experience: "/services/experience",
};

const sectionKeywords: Record<ConciergeSection, string[]> = {
  stays: ["stay", "villa", "room", "suite", "accommodation", "bedroom", "beach house", "house"],
  drive: ["airport", "pickup", "dropoff", "drop-off", "transfer", "ride", "car", "chauffeur", "driver", "vehicle"],
  dine: ["chef", "cook", "menu", "meal", "dinner", "lunch", "breakfast", "private chef", "birthday dinner"],
  relax: ["laundry", "shopping", "grocery", "groceries", "fridge", "stocking", "errand", "cleaning", "setup", "birthday setup", "decor"],
  experience: ["experience", "tour", "sunset", "boat", "snorkeling", "outing", "adventure", "package", "date night"],
};

const fillerWords = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "on",
  "the",
  "to",
  "with",
  "today",
  "tonight",
  "tomorrow",
  "this",
  "that",
  "need",
  "want",
  "please",
]);

const tokenSynonyms: Record<string, string[]> = {
  heritage: ["historic", "history", "cultural", "culture", "ruins", "gedi", "gede"],
  ruins: ["heritage", "historic", "gedi", "gede"],
  cultural: ["culture", "heritage", "historic"],
  sunset: ["sundowner", "evening"],
  beach: ["coast", "coastal", "ocean", "sea"],
  beachfront: ["beachfront", "oceanfront"],
  chauffeur: ["driver", "driven", "pickup", "transfer"],
  pickup: ["pick", "airport", "transfer", "chauffeur"],
  chef: ["cook", "private chef", "dining"],
  laundry: ["washing", "wash", "cleaning"],
  grocery: ["groceries", "shopping", "fridge", "stocking"],
};

const genericStayTokens = new Set(["accommodation", "apartment", "home", "house", "room", "stay", "suite", "villa"]);

export function ConciergeSearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState("");

  return (
    <ConciergeSearchContext.Provider
      value={{
        query,
        setQuery,
        clearQuery: () => setQuery(""),
      }}
    >
      {children}
    </ConciergeSearchContext.Provider>
  );
}

export function useConciergeSearch() {
  const context = useContext(ConciergeSearchContext);

  if (!context) {
    throw new Error("useConciergeSearch must be used within a ConciergeSearchProvider");
  }

  return context;
}

export function getSectionFromPath(path: string): ConciergeSection | null {
  const normalizedPath = path.split("?")[0];

  if (normalizedPath === "/accommodations" || normalizedPath.startsWith("/accommodation/")) {
    return "stays";
  }

  if (normalizedPath === "/services/drive") {
    return "drive";
  }

  if (normalizedPath === "/services/dine") {
    return "dine";
  }

  if (normalizedPath === "/services/relax") {
    return "relax";
  }

  if (normalizedPath === "/services/experience") {
    return "experience";
  }

  return null;
}

export function getRouteForSection(section: ConciergeSection) {
  return sectionRoutes[section];
}

export function getSectionLabel(section: ConciergeSection) {
  switch (section) {
    case "stays":
      return "Stays";
    case "drive":
      return "Drive";
    case "dine":
      return "Dine";
    case "relax":
      return "Relax";
    case "experience":
      return "Experience";
  }
}

export function normalizeConciergeQuery(query: string) {
  return query.toLowerCase().replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
}

export function getMeaningfulTokens(query: string) {
  return normalizeConciergeQuery(query)
    .split(" ")
    .filter((token) => token && !fillerWords.has(token));
}

export function extractGuestCount(query: string) {
  const normalizedQuery = normalizeConciergeQuery(query);
  const match = normalizedQuery.match(/\b(?:for|of)\s+(\d+)\b/) ?? normalizedQuery.match(/\b(\d+)\s+(?:guests?|people|pax)\b/);

  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function inferSectionFromQuery(query: string, fallbackSection: ConciergeSection) {
  const normalizedQuery = normalizeConciergeQuery(query);

  if (!normalizedQuery) {
    return fallbackSection;
  }

  const scores = (Object.keys(sectionKeywords) as ConciergeSection[]).map((section) => {
    const score = sectionKeywords[section].reduce((total, keyword) => {
      return normalizedQuery.includes(keyword) ? total + 1 : total;
    }, 0);

    return { section, score };
  });

  const topMatch = scores.sort((left, right) => right.score - left.score)[0];
  return topMatch && topMatch.score > 0 ? topMatch.section : fallbackSection;
}

function getTokenVariants(token: string) {
  return [token, ...(tokenSynonyms[token] ?? [])];
}

function matchesFreeText(fields: Array<string | number | null | undefined>, query: string) {
  const tokens = getMeaningfulTokens(query);

  if (tokens.length === 0) {
    return true;
  }

  const haystack = normalizeConciergeQuery(fields.filter(Boolean).join(" "));
  return tokens.every((token) => getTokenVariants(token).some((variant) => haystack.includes(variant)));
}

function parseStayCountIntent(normalizedQuery: string, unitPattern: string) {
  const explicitMinimum =
    normalizedQuery.match(new RegExp(`\\b(?:at least|min(?:imum)?|minimum of)\\s+(\\d+)\\s*${unitPattern}s?\\b`)) ??
    normalizedQuery.match(new RegExp(`\\b(\\d+)\\s*\\+\\s*${unitPattern}s?\\b`));
  const exact = normalizedQuery.match(new RegExp(`\\b(\\d+)\\s*${unitPattern}s?\\b`));
  const match = explicitMinimum ?? exact;

  if (!match) {
    return null;
  }

  const count = Number.parseInt(match[1], 10);
  if (Number.isNaN(count)) {
    return null;
  }

  return {
    count,
    mode: explicitMinimum ? "minimum" : "exact",
  } as const;
}

function matchesStayCount(actualCount: number, intent: ReturnType<typeof parseStayCountIntent>) {
  if (!intent) {
    return true;
  }

  return intent.mode === "minimum" ? actualCount >= intent.count : actualCount === intent.count;
}

function getStayTextTokens(query: string) {
  const tokens = getMeaningfulTokens(query);
  const descriptiveTokens = tokens.filter((token) => !genericStayTokens.has(token));
  return descriptiveTokens.length > 0 ? descriptiveTokens : tokens;
}

function matchesStayFreeText(fields: Array<string | number | null | undefined>, query: string) {
  const tokens = getStayTextTokens(query);

  if (tokens.length === 0) {
    return true;
  }

  const haystack = normalizeConciergeQuery(fields.filter(Boolean).join(" "));
  return tokens.every((token) => getTokenVariants(token).some((variant) => haystack.includes(variant)));
}

export function filterStays(stays: Stay[], query: string) {
  const normalizedQuery = normalizeConciergeQuery(query);
  const guestCount = extractGuestCount(query);
  const bedroomIntent = parseStayCountIntent(normalizedQuery, "bed(?:room)?");
  const bathroomIntent = parseStayCountIntent(normalizedQuery, "bath(?:room)?");

  return stays.filter((stay) => {
    const structuredTerms = [
      `${stay.bedrooms} bedroom`,
      `${stay.bedrooms} bedrooms`,
      `${stay.bathrooms} bathroom`,
      `${stay.bathrooms} bathrooms`,
      `${stay.maxOccupancy} guests`,
      `${stay.maxOccupancy} people`,
    ];
    const matchesText = matchesStayFreeText(
      [stay.title, stay.location, stay.description, ...stay.features, ...structuredTerms],
      query,
    );
    const matchesGuests = guestCount === null || stay.maxOccupancy >= guestCount;
    const matchesBedrooms = matchesStayCount(stay.bedrooms, bedroomIntent);
    const matchesBathrooms = matchesStayCount(stay.bathrooms, bathroomIntent);

    return matchesGuests && matchesBedrooms && matchesBathrooms && matchesText;
  });
}

export function filterCars(cars: Car[], query: string) {
  const normalizedQuery = normalizeConciergeQuery(query);
  const guestCount = extractGuestCount(query);
  const airportIntent = /airport|pickup|pick up|dropoff|drop off|transfer/.test(normalizedQuery);
  const chauffeurIntent = /chauffeur|driver|pickup|transfer|airport/.test(normalizedQuery);
  const selfDriveIntent = /self drive|self-drive|drive myself/.test(normalizedQuery);

  return cars.filter((car) => {
    const structuredTerms = [
      car.priceWithDriver > 0 ? "chauffeur driver full day transfer airport pickup" : "",
      car.priceWithDriverHourly ? "chauffeur hourly hourly driver by hour" : "",
      car.pricePerDay ? "self drive self-drive rental per day" : "",
      car.chauffeurZones.length > 0 ? car.chauffeurZones.map((zone) => `${zone.name} zone transfer chauffeur`).join(" ") : "",
      car.seats ? `${car.seats} seater seats` : "",
    ];
    const matchesText = matchesFreeText(
      [car.model, car.location, car.description, car.transmission, ...car.features, ...structuredTerms],
      query,
    );
    const matchesGuests = guestCount === null || car.seats >= guestCount;
    const matchesAirport = !airportIntent || car.priceWithDriver > 0;
    const matchesMode = !selfDriveIntent || Boolean(car.pricePerDay);
    const matchesChauffeur = !chauffeurIntent || car.priceWithDriver > 0 || car.chauffeurZones.length > 0;

    return matchesGuests && matchesAirport && matchesMode && matchesChauffeur && (matchesText || airportIntent);
  });
}

export function filterCooks(cooks: Cook[], query: string) {
  const normalizedQuery = normalizeConciergeQuery(query);
  const guestCount = extractGuestCount(query);
  const chefIntent = /chef|cook|menu|meal|dinner|breakfast|lunch|birthday/.test(normalizedQuery);

  return cooks.filter((cook) => {
    const structuredTerms = [
      cook.ingredientsIncluded ? "ingredients included full dining package" : "",
      cook.shoppingIncluded ? "shopping included grocery included market run" : "",
      cook.customMenuEnabled ? "custom menu bespoke menu private dining special request" : "",
      `${cook.minimumGuests} guests minimum`,
      `${cook.maxGuests} guests maximum`,
      `${cook.speciality} cuisine`,
    ];
    const matchesText = matchesFreeText(
      [cook.title, cook.location, cook.description, cook.serviceType, cook.speciality, ...cook.features, ...cook.sampleMenus, ...structuredTerms],
      query,
    );
    const matchesGuests =
      guestCount === null || (cook.minimumGuests <= guestCount && cook.maxGuests >= guestCount);
    const matchesChefIntent = !chefIntent || cook.customMenuEnabled || cook.ingredientsIncluded;

    return matchesGuests && matchesChefIntent && (matchesText || chefIntent);
  });
}

export function filterErrands(errands: Errand[], query: string) {
  const normalizedQuery = normalizeConciergeQuery(query);
  const laundryIntent = /laundry|wash|clean clothes/.test(normalizedQuery);
  const shoppingIntent = /shopping|grocery|groceries|fridge|stocking/.test(normalizedQuery);
  const cleaningIntent = /cleaning|house cleaning|housekeeping/.test(normalizedQuery);
  const childcareIntent = /childcare|child care|kids|children|baby|infant|mama|mother|family|clinic|nanny|carer|supervision/.test(normalizedQuery);
  const setupIntent = /birthday|setup|decor|surprise/.test(normalizedQuery);

  return errands.filter((errand) => {
    const childcareText = [errand.serviceName, errand.description, ...(errand.features ?? [])].join(" ").toLowerCase();
    const childcareEnabled = /\b(childcare|child care|children|kids|baby|babies|infant|mama|mother|family|clinic|supervision|nanny|carer)\b/.test(childcareText);
    const structuredTerms = [
      errand.shoppingEnabled ? "grocery shopping fridge stocking shopping delivery market run" : "",
      errand.laundryEnabled ? `laundry mama fua washing pickup ${errand.laundryIncludedKg} kg ${errand.laundryPricePerKg} per kg` : "",
      errand.houseCleaningEnabled ? "house cleaning housekeeping villa cleaning" : "",
      childcareEnabled ? "childcare child care kids children baby infant help mama family support clinic visit nanny carer supervision feeding diaper" : "",
      ...(errand.laundryAddons ?? []).map((addon) => addon.name),
      ...(errand.houseCleaningAddons ?? []).map((addon) => addon.name),
    ];
    const matchesText = matchesFreeText(
      [errand.serviceName, errand.location, errand.description, ...errand.features, ...structuredTerms],
      query,
    );
    const matchesLaundry = !laundryIntent || errand.laundryEnabled;
    const matchesShopping = !shoppingIntent || errand.shoppingEnabled;
    const matchesCleaning = !cleaningIntent || errand.houseCleaningEnabled;
    const matchesChildcare = !childcareIntent || childcareEnabled;

    return matchesLaundry && matchesShopping && matchesCleaning && matchesChildcare && (matchesText || setupIntent);
  });
}

export function filterExperiences(experiences: Experience[], query: string) {
  const normalizedQuery = normalizeConciergeQuery(query);
  const guestCount = extractGuestCount(query);
  const experienceIntent = /experience|tour|boat|snorkeling|outing|adventure|sunset|date|package|birthday/.test(normalizedQuery);

  return experiences.filter((experience) => {
    const addonNames = [...(experience.privateAddons ?? []), ...(experience.sharedAddons ?? [])].map((addon) => addon.name);
    const structuredTerms = [
      experience.privateEnabled ? "private experience private booking" : "",
      experience.sharedEnabled ? "shared experience shared departure group booking" : "",
      experience.customQuoteEnabled ? "custom quote bespoke experience tailored package" : "",
      `${experience.durationHours} hours`,
      `${experience.minGuests} guests minimum`,
      `${experience.maxGuests} guests maximum`,
      `${experience.privateMinimumGuests} guests private minimum`,
      `${experience.sharedMinimumGuests} guests shared minimum`,
    ];
    const matchesText = matchesFreeText(
      [
        experience.title,
        experience.location,
        experience.experienceLocation,
        experience.description,
        experience.experienceType,
        ...experience.features,
        ...experience.inclusions,
        ...experience.exclusions,
        ...(experience.sharedDepartures ?? []).map((departure) => `${departure.date} ${departure.time}`),
        ...addonNames,
        ...structuredTerms,
      ],
      query,
    );
    const matchesGuests = guestCount === null || (experience.minGuests <= guestCount && experience.maxGuests >= guestCount);

    return matchesGuests && (matchesText || experienceIntent);
  });
}
