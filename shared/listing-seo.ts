// Search engine work for each public listing: the phrases it can rank for, who
// it is up against in Google, suggested titles, descriptions and photo text, a
// checklist score, and the area pages that link listings together. One module
// for the admin SEO page, the server's page metadata and the listing pages, so
// they always agree.
//
// There are no live search volumes here. Phrases are ranked by how well they
// fit the listing's own facts and how crowded the search is, using known search
// patterns for the Kenyan Coast. A phrase is only suggested when the listing's
// own text backs it (a pool, a beach, a place name), so a title never promises
// something the listing doesn't have.
import { getCarDisplayName } from "./listing-share.ts";
import { type PublicListingKind } from "./seo.ts";

// ── Places ───────────────────────────────────────────────────────────────

export type SeoArea = {
  key: string;
  name: string;
  /** Words in a listing's location or text that place it here. More specific areas come first in seoAreas. */
  aliases: string[];
  /** Places guests search for by name. Only used in a phrase when the listing's own text names them. */
  landmarks: string[];
  airport: string;
};

export const seoAreas: SeoArea[] = [
  { key: "nyali", name: "Nyali", aliases: ["nyali"], landmarks: ["Nyali Beach", "Haller Park", "Mamba Village"], airport: "Moi International Airport" },
  { key: "shanzu", name: "Shanzu", aliases: ["shanzu", "serena beach"], landmarks: ["Shanzu Beach", "Haller Park"], airport: "Moi International Airport" },
  { key: "bamburi", name: "Bamburi", aliases: ["bamburi", "kenyatta beach"], landmarks: ["Bamburi Beach", "Haller Park"], airport: "Moi International Airport" },
  { key: "mtwapa", name: "Mtwapa", aliases: ["mtwapa", "kikambala", "kanamai"], landmarks: ["Mtwapa Creek", "Jumba la Mtwana", "Kikambala Beach"], airport: "Moi International Airport" },
  { key: "kilifi", name: "Kilifi", aliases: ["kilifi", "vipingo", "takaungu", "bofa"], landmarks: ["Kilifi Creek", "Bofa Beach", "Mnarani Ruins", "Vipingo"], airport: "Moi International Airport" },
  { key: "watamu", name: "Watamu", aliases: ["watamu", "mida creek", "turtle bay", "gede"], landmarks: ["Watamu Marine Park", "Mida Creek", "Gede Ruins", "Arabuko Sokoke Forest", "Turtle Bay"], airport: "Malindi Airport" },
  { key: "mambrui", name: "Mambrui", aliases: ["mambrui"], landmarks: ["Mambrui sand dunes", "Sabaki River"], airport: "Malindi Airport" },
  { key: "malindi", name: "Malindi", aliases: ["malindi", "silversands", "marafa"], landmarks: ["Malindi Marine Park", "Vasco da Gama Pillar", "Marafa", "Hell's Kitchen", "Silversands Beach"], airport: "Malindi Airport" },
  { key: "lamu", name: "Lamu", aliases: ["lamu", "shela", "manda"], landmarks: ["Lamu Old Town", "Shela Beach", "Manda Island", "Takwa Ruins"], airport: "Manda Airport" },
  { key: "shimoni", name: "Shimoni", aliases: ["shimoni", "wasini", "kisite"], landmarks: ["Wasini Island", "Kisite Marine Park", "Shimoni Caves"], airport: "Ukunda Airstrip" },
  { key: "msambweni", name: "Msambweni", aliases: ["msambweni", "funzi", "gazi"], landmarks: ["Msambweni Beach", "Funzi Island", "Gazi Bay"], airport: "Ukunda Airstrip" },
  { key: "diani", name: "Diani", aliases: ["diani", "ukunda", "galu", "tiwi", "kinondo"], landmarks: ["Diani Beach", "Galu Beach", "Tiwi Beach", "Colobus Conservation", "Shimba Hills", "Kongo Mosque"], airport: "Ukunda Airstrip" },
  { key: "mombasa", name: "Mombasa", aliases: ["mombasa", "old town", "tudor", "kizingo", "likoni", "kisauni", "mkomani", "miritini", "changamwe"], landmarks: ["Fort Jesus", "Mombasa Old Town", "Mombasa Marine Park", "Likoni Ferry", "Haller Park"], airport: "Moi International Airport" },
];

const areaByKey = new Map(seoAreas.map((area) => [area.key, area]));

export function getSeoArea(key: string | null | undefined) {
  return key ? areaByKey.get(key) ?? null : null;
}

function wordPattern(word: string) {
  return new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
}

/** The first area (most specific first) whose name appears in the text. */
export function detectSeoArea(...texts: Array<string | null | undefined>): SeoArea | null {
  for (const text of texts) {
    const value = (text ?? "").toLowerCase();
    if (!value.trim()) continue;
    const match = seoAreas.find((area) => area.aliases.some((alias) => wordPattern(alias).test(value)));
    if (match) return match;
  }
  return null;
}

// ── Area pages ────────────────────────────────────────────────────────────

export const seoAreaServices = ["stays", "cars", "chefs", "experiences", "home-help"] as const;
export type SeoAreaService = (typeof seoAreaServices)[number];

export const seoServiceByKind: Record<PublicListingKind, SeoAreaService> = {
  stay: "stays",
  car: "cars",
  cook: "chefs",
  experience: "experiences",
  errand: "home-help",
};

export const seoKindByService: Record<SeoAreaService, PublicListingKind> = {
  stays: "stay",
  cars: "car",
  chefs: "cook",
  experiences: "experience",
  "home-help": "errand",
};

export function isSeoAreaService(value: unknown): value is SeoAreaService {
  return typeof value === "string" && (seoAreaServices as readonly string[]).includes(value);
}

export function areaPagePath(areaKey: string, service: SeoAreaService) {
  return `/explore/${areaKey}/${service}`;
}

const areaServiceHeading: Record<SeoAreaService, (area: string) => string> = {
  stays: (area) => `Places to stay in ${area}`,
  cars: (area) => `Car hire and drivers in ${area}`,
  chefs: (area) => `Private chefs in ${area}`,
  experiences: (area) => `Things to do in ${area}`,
  "home-help": (area) => `Home help and childcare in ${area}`,
};

const areaServiceTitle: Record<SeoAreaService, (area: string) => string> = {
  stays: (area) => `Where to stay in ${area}: villas, apartments and hotels`,
  cars: (area) => `Car hire in ${area} with a driver or self-drive`,
  chefs: (area) => `Private chefs in ${area} for your villa`,
  experiences: (area) => `Things to do in ${area}: tours and boat trips`,
  "home-help": (area) => `Nannies, cleaning and laundry in ${area}`,
};

const areaServiceLead: Record<SeoAreaService, string> = {
  stays: "Villas, apartments, cottages and hotels",
  cars: "Cars with drivers, self-drive hire and airport transfers",
  chefs: "Private chefs who cook in your villa or apartment",
  experiences: "Boat trips, snorkelling, walks and day trips",
  "home-help": "Holiday nannies, house cleaning, laundry and shopping",
};

export function areaPageHeading(area: SeoArea, service: SeoAreaService) {
  return areaServiceHeading[service](area.name);
}

/** Each service's own browse page, where a listing whose area isn't known is filed. */
export const seoCategoryPages: Record<PublicListingKind, { label: string; path: string }> = {
  stay: { label: "Places to stay", path: "/accommodations" },
  car: { label: "Car hire and drivers", path: "/services/drive" },
  cook: { label: "Private chefs", path: "/services/dine" },
  errand: { label: "Home help", path: "/services/relax" },
  experience: { label: "Experiences", path: "/services/experience" },
};

/** Where a listing sits for Google's breadcrumb and the page's own: its area page, else its service page. */
export function listingBreadcrumb(kind: PublicListingKind, area: Pick<SeoArea, "key"> | null) {
  const record = area ? getSeoArea(area.key) : null;
  const service = seoServiceByKind[kind];
  return record ? { label: areaServiceHeading[service](record.name), path: areaPagePath(record.key, service) } : seoCategoryPages[kind];
}

export const seoBrand = "Tembea Bila Matata";
export const seoTitleLimit = 60;
export const seoDescriptionLimit = 155;

/** Adds the brand when it fits in what Google shows (about 60 characters), the short brand if that fits, else nothing. */
export function withSeoBrand(title: string) {
  const full = `${title} | ${seoBrand}`;
  if (full.length <= seoTitleLimit) return full;
  const short = `${title} | TBM`;
  return short.length <= seoTitleLimit ? short : title;
}

export function defaultAreaPageCopy(area: SeoArea, service: SeoAreaService) {
  const landmarks = area.landmarks.slice(0, 3);
  const landmarkLine = landmarks.length
    ? ` ${area.name} is known for ${landmarks.slice(0, -1).join(", ")}${landmarks.length > 1 ? " and " : ""}${landmarks[landmarks.length - 1]}.`
    : "";
  return {
    heading: areaServiceHeading[service](area.name),
    title: withSeoBrand(areaServiceTitle[service](area.name)),
    description: clipText(`${areaServiceLead[service]} in ${area.name}, on the Kenyan Coast. See prices in KSh, book on TBM and pay by M-Pesa or card.`, seoDescriptionLimit),
    intro: `${areaServiceLead[service]} in ${area.name}, listed by local providers on Tembea Bila Matata.${landmarkLine} Every price is shown before you book, and you pay through TBM by M-Pesa or card.`,
  };
}

// ── A listing, as SEO sees it ────────────────────────────────────────────

export type SeoListingInput = {
  kind: PublicListingKind;
  id: string;
  name: string;
  location: string;
  description: string;
  features: string[];
  photos: string[];
  hasPrice: boolean;
  reviewCount: number;
  isPublic: boolean;
  stay?: { hotel: boolean; starRating: number | null; bedrooms: number; maxGuests: number };
  car?: { seats: number; selfDrive: boolean; services: string[] };
  cook?: { speciality: string; serviceType: string };
  errand?: { serviceName: string; shopping: boolean; laundry: boolean; cleaning: boolean; childcare: boolean };
  experience?: { type: string; destination: string; durationHours: number; private: boolean; shared: boolean; meetingPoint: string };
};

const text = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0);
const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []);

export function seoListingName(kind: PublicListingKind, row: Record<string, unknown>) {
  if (kind === "car") return getCarDisplayName({ make: text(row.make), model: text(row.model) });
  if (kind === "errand") return text(row.serviceName) || "Home help";
  return text(row.title) || "Listing";
}

/** Turns a stays/cars/cooks/errands/experiences row into what the SEO rules read. */
export function toSeoListingInput(kind: PublicListingKind, row: Record<string, unknown>): SeoListingInput {
  const photos = [text(row.imageUrl), ...list(row.galleryUrls)].filter(Boolean);
  const base: SeoListingInput = {
    kind,
    id: text(row.id),
    name: seoListingName(kind, row),
    location: text(row.location),
    description: text(row.description),
    features: list(row.features),
    photos: Array.from(new Set(photos)),
    hasPrice: false,
    reviewCount: num(row.reviewCount),
    isPublic: row.isPublic === true,
  };
  if (kind === "stay") {
    base.hasPrice = num(row.price) > 0;
    base.stay = { hotel: row.propertyType === "hotel", starRating: num(row.starRating) || null, bedrooms: num(row.bedrooms), maxGuests: num(row.maxOccupancy) };
  } else if (kind === "car") {
    base.hasPrice = num(row.pricePerDay) > 0 || num(row.priceWithDriver) > 0 || num(row.priceWithDriverHourly) > 0;
    base.car = { seats: num(row.seats), selfDrive: num(row.pricePerDay) > 0, services: list(row.suitableServices) };
  } else if (kind === "cook") {
    base.hasPrice = num(row.pricePerSession) > 0 || num(row.serviceFee) > 0 || num(row.pricePerPlate) > 0;
    base.cook = { speciality: text(row.speciality), serviceType: text(row.serviceType) };
    base.features = [...base.features, ...list(row.sampleMenus)];
  } else if (kind === "errand") {
    const helpMama = (row.helpMamaPricing ?? {}) as { enabled?: boolean };
    base.hasPrice = num(row.basePrice) > 0;
    base.errand = {
      serviceName: text(row.serviceName),
      shopping: row.shoppingEnabled === true,
      laundry: row.laundryEnabled === true,
      cleaning: row.houseCleaningEnabled === true,
      childcare: helpMama.enabled === true,
    };
  } else {
    base.hasPrice = num(row.privatePricePerPerson) > 0 || num(row.sharedPricePerPerson) > 0 || num(row.price) > 0;
    base.experience = {
      type: text(row.experienceType),
      destination: text(row.experienceLocation),
      durationHours: num(row.durationHours),
      private: row.privateEnabled !== false,
      shared: row.sharedEnabled === true,
      meetingPoint: text(row.meetingPoint),
    };
    base.features = [...base.features, ...list(row.inclusions)];
  }
  return base;
}

/** The area a listing belongs to: an experience's destination first, then where the listing is. */
export function listingSeoArea(input: Pick<SeoListingInput, "kind" | "location" | "name" | "experience">) {
  return detectSeoArea(input.experience?.destination, input.location, input.name);
}

// ── Search phrases ───────────────────────────────────────────────────────

export type SeoCompetition = "High" | "Medium" | "Lower";

export type SeoKeyword = {
  phrase: string;
  competition: SeoCompetition;
  /** Booking searches convert; planning searches bring visitors who book later. */
  intent: "Booking" | "Planning";
  why: string;
};

const competitionWhy: Record<SeoCompetition, string> = {
  High: "Crowded: big sites fill the first page. Use it on the area page and in the description, not as the main phrase.",
  Medium: "A real search with room for a specific listing. The best main phrase when it fits.",
  Lower: "Fewer people search it, but those who do want exactly this, and few pages compete.",
};

function lowerText(input: SeoListingInput) {
  return [input.name, input.description, input.location, ...input.features, input.experience?.type, input.experience?.destination, input.cook?.speciality, input.errand?.serviceName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function stayNoun(input: Pick<SeoListingInput, "name" | "description" | "features" | "stay">) {
  if (input.stay?.hotel) return "hotel";
  const value = [input.name, input.description, ...input.features].join(" ").toLowerCase();
  const nouns: Array<[RegExp, string]> = [
    [/\bvillas?\b/, "villa"],
    [/\bpenthouse\b/, "penthouse"],
    [/\bstudio\b/, "studio apartment"],
    [/\b(apartment|flat)s?\b/, "apartment"],
    [/\bcottages?\b/, "cottage"],
    [/\bguest ?house\b/, "guest house"],
    [/\bbungalows?\b/, "bungalow"],
    [/\bbandas?\b/, "banda"],
    [/\b(house|home|maisonette)s?\b/, "holiday home"],
  ];
  return nouns.find(([pattern]) => pattern.test(value))?.[1] ?? "holiday home";
}

const plural = (noun: string) => (noun.endsWith("s") ? noun : noun.endsWith("y") ? `${noun.slice(0, -1)}ies` : `${noun}s`);

type Candidate = { phrase: string; competition: SeoCompetition; intent?: "Booking" | "Planning" };

function landmarksIn(area: SeoArea | null, value: string) {
  return (area?.landmarks ?? []).filter((landmark) => value.includes(landmark.toLowerCase().replace(/'s$/, "")));
}

function stayCandidates(input: SeoListingInput, area: string, value: string, landmarks: string[]): Candidate[] {
  const noun = stayNoun(input);
  const hotel = input.stay?.hotel === true;
  const pool = /\bpool\b/.test(value);
  const beachfront = /beach ?front|on the beach|ocean ?front|sea ?front|steps (to|from) the beach|direct beach/.test(value);
  const seaView = /(sea|ocean) views?/.test(value);
  const chef = /\b(chef|cook)\b/.test(value);
  const family = (input.stay?.bedrooms ?? 0) >= 3 || /\b(family|families|kids|children)\b/.test(value);
  const breakfast = /breakfast|half board|full board|all inclusive/.test(value);
  const bedrooms = input.stay?.bedrooms ?? 0;
  const out: Candidate[] = [];
  if (pool) out.push({ phrase: `${noun} in ${area} with pool`, competition: "Medium" });
  if (beachfront) out.push({ phrase: `beachfront ${noun} in ${area}`, competition: "Medium" });
  if (hotel && input.stay?.starRating) out.push({ phrase: `${input.stay.starRating} star hotel in ${area}`, competition: "Medium" });
  if (!hotel && /apartment|studio|penthouse/.test(noun)) {
    out.push({ phrase: `short stay apartments in ${area}`, competition: "Medium" });
    out.push({ phrase: `furnished apartment in ${area}`, competition: "Medium" });
  }
  if (family && !hotel) out.push({ phrase: `family ${noun} in ${area}`, competition: "Medium" });
  if (seaView) out.push({ phrase: `${noun} with sea view in ${area}`, competition: "Lower" });
  if (bedrooms >= 2 && !hotel) out.push({ phrase: `${bedrooms} bedroom ${noun} in ${area}`, competition: "Lower" });
  if (chef && !hotel) out.push({ phrase: `${noun} in ${area} with chef`, competition: "Lower" });
  if (hotel && breakfast) out.push({ phrase: `${area} hotel with breakfast`, competition: "Lower" });
  if (pool && beachfront) out.push({ phrase: `beachfront ${noun} with pool ${area}`, competition: "Lower" });
  for (const landmark of landmarks.slice(0, 2)) out.push({ phrase: `${noun} near ${landmark}`, competition: "Lower" });
  out.push({ phrase: `${plural(noun)} in ${area}`, competition: "High" });
  out.push({ phrase: hotel ? `hotels in ${area}` : `holiday rentals in ${area}`, competition: "High" });
  out.push({ phrase: `where to stay in ${area}`, competition: "High", intent: "Planning" });
  return out;
}

function carCandidates(input: SeoListingInput, areaRecord: SeoArea | null, area: string, value: string): Candidate[] {
  const services = input.car?.services ?? [];
  const airport = services.includes("airport_transfers") || /airport|transfer|\bsgr\b|pick ?up/.test(value);
  const driver = services.includes("chauffeur_services") || /driver|chauffeur/.test(value) || !input.car?.selfDrive;
  const seats = input.car?.seats ?? 0;
  const out: Candidate[] = [];
  if (airport) {
    if (areaRecord && areaRecord.key !== "mombasa" && areaRecord.key !== "nyali" && areaRecord.key !== "bamburi") {
      out.push({ phrase: `Mombasa airport to ${area} transfer`, competition: "Medium" });
      out.push({ phrase: `SGR to ${area} transfer`, competition: "Lower" });
    } else {
      out.push({ phrase: "Mombasa airport transfer", competition: "Medium" });
      out.push({ phrase: "SGR Mombasa transfer", competition: "Lower" });
    }
    if (areaRecord?.airport && !/Moi International/.test(areaRecord.airport)) out.push({ phrase: `${areaRecord.airport} transfer`, competition: "Lower" });
  }
  if (driver) out.push({ phrase: `car hire with driver in ${area}`, competition: "Medium" });
  if (input.car?.selfDrive) out.push({ phrase: `self drive car hire ${area}`, competition: "Medium" });
  if (seats >= 7) out.push({ phrase: `${seats} seater van hire ${area}`, competition: "Lower" });
  if (services.includes("safari_transport") || /safari|tsavo/.test(value)) out.push({ phrase: `safari van hire ${area}`, competition: "Lower" });
  if (services.includes("wedding_transport") || /wedding/.test(value)) out.push({ phrase: `wedding car hire ${area}`, competition: "Lower" });
  if (input.name && input.name !== "Car") out.push({ phrase: `${input.name} for hire in ${area}`, competition: "Lower" });
  if (driver) out.push({ phrase: `driver for hire ${area}`, competition: "Medium" });
  out.push({ phrase: `car hire in ${area}`, competition: "High" });
  out.push({ phrase: `car rental ${area}`, competition: "High" });
  return out;
}

function cookCandidates(input: SeoListingInput, area: string, value: string): Candidate[] {
  const out: Candidate[] = [{ phrase: `private chef in ${area}`, competition: "Medium" }];
  const cuisines = ["Swahili", "seafood", "Italian", "Indian", "BBQ", "vegan", "vegetarian", "French", "Lebanese", "Asian", "Kenyan"]
    .filter((cuisine) => value.includes(cuisine.toLowerCase()));
  for (const cuisine of cuisines.slice(0, 2)) out.push({ phrase: `${cuisine} chef in ${area}`, competition: "Lower" });
  out.push({ phrase: `chef for hire ${area}`, competition: "Medium" });
  out.push({ phrase: `villa chef ${area}`, competition: "Lower" });
  if (/dinner|romantic|anniversary|birthday/.test(value)) out.push({ phrase: `private dinner ${area}`, competition: "Lower" });
  if (/class|lesson|teach/.test(value)) out.push({ phrase: `cooking class ${area}`, competition: "Lower" });
  out.push({ phrase: `catering ${area}`, competition: "High" });
  return out;
}

function errandCandidates(input: SeoListingInput, area: string, value: string): Candidate[] {
  const errand = input.errand;
  const out: Candidate[] = [];
  if (errand?.childcare || /nanny|babysit|child ?care|kids/.test(value)) {
    out.push({ phrase: `holiday nanny in ${area}`, competition: "Lower" });
    out.push({ phrase: `babysitter in ${area}`, competition: "Medium" });
  }
  if (errand?.cleaning || /clean/.test(value)) {
    out.push({ phrase: `house cleaning ${area}`, competition: "Medium" });
    out.push({ phrase: `villa cleaning service ${area}`, competition: "Lower" });
  }
  if (errand?.laundry || /laundry/.test(value)) {
    out.push({ phrase: `laundry service ${area}`, competition: "Medium" });
    out.push({ phrase: `laundry pick up and delivery ${area}`, competition: "Lower" });
  }
  if (errand?.shopping || /shopping|grocer/.test(value)) out.push({ phrase: `grocery shopping service ${area}`, competition: "Lower" });
  out.push({ phrase: `villa concierge ${area}`, competition: "Lower" });
  out.push({ phrase: `home help ${area}`, competition: "High" });
  return out;
}

const activityPhrases: Array<[RegExp, (area: string) => Candidate[]]> = [
  [/dhow/, (a) => [{ phrase: `dhow cruise ${a}`, competition: "Medium" }, { phrase: `sunset dhow cruise ${a}`, competition: "Lower" }]],
  [/snorkel/, (a) => [{ phrase: `snorkelling in ${a}`, competition: "Medium" }, { phrase: `snorkelling trip ${a}`, competition: "Lower" }]],
  [/dolphin/, (a) => [{ phrase: `dolphin watching ${a}`, competition: "Medium" }]],
  [/scuba|\bdiv(e|ing)\b/, (a) => [{ phrase: `scuba diving ${a}`, competition: "Medium" }]],
  [/kite ?surf/, (a) => [{ phrase: `kitesurfing lessons ${a}`, competition: "Medium" }]],
  [/fishing/, (a) => [{ phrase: `deep sea fishing ${a}`, competition: "Medium" }]],
  [/safari|tsavo|game drive/, (a) => [{ phrase: `safari from ${a}`, competition: "Medium" }, { phrase: `Tsavo day trip from ${a}`, competition: "Lower" }]],
  [/cooking|cookery/, (a) => [{ phrase: `Swahili cooking class ${a}`, competition: "Lower" }]],
  [/walking|heritage|history|old town|fort jesus|ruins/, (a) => [{ phrase: `${a} walking tour`, competition: "Lower" }, { phrase: `${a} history tour`, competition: "Lower" }]],
  [/forest|bird|nature|hike|hiking/, (a) => [{ phrase: `nature walk ${a}`, competition: "Lower" }]],
  [/canoe|kayak|paddle/, (a) => [{ phrase: `kayaking ${a}`, competition: "Lower" }]],
  [/sunset/, (a) => [{ phrase: `sunset cruise ${a}`, competition: "Lower" }]],
  [/island/, (a) => [{ phrase: `island trip from ${a}`, competition: "Lower" }]],
  [/boat|marine|reef|glass.?bottom/, (a) => [{ phrase: `boat trip ${a}`, competition: "Medium" }, { phrase: `marine park trip ${a}`, competition: "Lower" }]],
  [/camel/, (a) => [{ phrase: `camel ride ${a}`, competition: "Lower" }]],
  [/quad|atv/, (a) => [{ phrase: `quad biking ${a}`, competition: "Lower" }]],
  [/skydiv/, (a) => [{ phrase: `skydiving ${a}`, competition: "Lower" }]],
];

function experienceCandidates(input: SeoListingInput, area: string, value: string, landmarks: string[]): Candidate[] {
  const out: Candidate[] = [];
  for (const [pattern, phrases] of activityPhrases) {
    if (pattern.test(value)) out.push(...phrases(area));
  }
  for (const landmark of landmarks.slice(0, 2)) out.push({ phrase: `${landmark} tour`, competition: "Lower" });
  const hours = input.experience?.durationHours ?? 0;
  if (input.experience?.private) out.push({ phrase: `private tour ${area}`, competition: "Medium" });
  if (hours > 0 && hours <= 5) out.push({ phrase: `half day trip ${area}`, competition: "Lower" });
  if (hours >= 6) out.push({ phrase: `day trip from ${area}`, competition: "Medium" });
  out.push({ phrase: `${area} excursions`, competition: "High" });
  out.push({ phrase: `things to do in ${area}`, competition: "High", intent: "Planning" });
  return out;
}

function normalisePhrase(phrase: string) {
  return phrase.replace(/\s+/g, " ").trim();
}

/** Every phrase this listing's facts back, best first: the main-phrase candidates, then the long tail, then the crowded head terms. */
export function suggestSeoKeywords(input: SeoListingInput): SeoKeyword[] {
  const areaRecord = listingSeoArea(input);
  const area = areaRecord?.name ?? (input.location.split(",")[0]?.trim() || "Mombasa");
  const value = lowerText(input);
  const landmarks = landmarksIn(areaRecord, value);
  const candidates = input.kind === "stay"
    ? stayCandidates(input, area, value, landmarks)
    : input.kind === "car"
      ? carCandidates(input, areaRecord, area, value)
      : input.kind === "cook"
        ? cookCandidates(input, area, value)
        : input.kind === "errand"
          ? errandCandidates(input, area, value)
          : experienceCandidates(input, area, value, landmarks);

  const order: Record<SeoCompetition, number> = { Medium: 0, Lower: 1, High: 2 };
  const seen = new Set<string>();
  return candidates
    .map((candidate, index) => ({ ...candidate, phrase: normalisePhrase(candidate.phrase), index }))
    .filter((candidate) => {
      const key = candidate.phrase.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => order[a.competition] - order[b.competition] || a.index - b.index)
    .map(({ phrase, competition, intent }) => ({ phrase, competition, intent: intent ?? "Booking", why: competitionWhy[competition] }));
}

// ── Who it's up against ──────────────────────────────────────────────────

export type SeoCompetitor = { name: string; where: string };

const competitors: Record<PublicListingKind, SeoCompetitor[]> = {
  stay: [
    { name: "Airbnb", where: "Fills the first page for \"villas in {area}\". In Kenya people also search \"Airbnb in {area}\" to mean any short-stay apartment." },
    { name: "Booking.com", where: "Ranks for \"hotels in {area}\" and \"apartments in {area}\" with thousands of reviews." },
    { name: "Tripadvisor", where: "Ranks for \"where to stay in {area}\" and \"best hotels in {area}\" lists." },
    { name: "Google Hotels and Maps", where: "Shows hotels with a Google Business Profile above the normal results." },
    { name: "Agents on Facebook, Instagram and Jiji", where: "Win on WhatsApp and price, but rarely rank in Google." },
  ],
  car: [
    { name: "Rentalcars.com, Discover Cars and Kayak", where: "Rank for \"car hire Mombasa\" and \"Mombasa airport car rental\". Strong on self-drive, weak on drivers and Coast transfers." },
    { name: "Uber and Bolt", where: "Take short town rides, not long transfers with luggage such as the airport to {area}." },
    { name: "Local car hire firms", where: "Show in the Google map results for \"car hire near me\" through their Google Business Profiles." },
    { name: "Facebook and Jiji adverts", where: "Cheap, with no checks on the car or the driver." },
  ],
  cook: [
    { name: "International private-chef sites", where: "Rank for \"private chef {area}\" in many countries, priced in dollars or euros." },
    { name: "Airbnb", where: "Lists chefs and cooking classes beside its stays." },
    { name: "Villa management companies", where: "Offer in-house cooks with their villas." },
    { name: "Chefs on Instagram", where: "Strong photos, but rarely rank in Google." },
  ],
  errand: [
    { name: "Nanny and cleaning agencies", where: "Rank for \"nanny {area}\" and \"house cleaning {area}\", usually for long-term hires." },
    { name: "Facebook groups and Jiji", where: "Where many families ask for help, with no checks." },
    { name: "Villa management companies", where: "Bundle cleaning and laundry with their villas." },
  ],
  experience: [
    { name: "Tripadvisor", where: "Ranks for \"things to do in {area}\" with lists and reviews." },
    { name: "GetYourGuide and Viator", where: "Sell tours in dollars and rank for named trips such as \"Wasini island tour\"." },
    { name: "Airbnb Experiences", where: "Strong for cooking classes and walks." },
    { name: "Hotel tour desks and beach operators", where: "Sell in person; few of them rank in Google." },
  ],
};

const beatThem: Record<PublicListingKind, string[]> = {
  stay: [
    "Win the specific searches the big sites don't write: the beach, the number of bedrooms, the pool, the chef.",
    "Never put a competitor's name in the title. Use \"short stay apartment\" or \"holiday rental\" to catch \"Airbnb in {area}\" searches.",
    "Show the KSh price and \"pay by M-Pesa\" in the description. Airbnb and Booking.com show dollars and need a card.",
    "Keep the listing text the provider's own and at least 120 words: walking time to the beach, the nearest supermarket, who it suits. Text copied from another site counts as a duplicate.",
    "Three reviews let star ratings show in Google. Ask the first guests.",
  ],
  car: [
    "Each route is its own search: \"Mombasa airport to {area} transfer\", \"SGR to {area}\". Name the routes in the listing text with a fixed price.",
    "Say \"with driver\", the seats and the luggage space. Aggregators don't say who drives.",
    "If TBM has checked the logbook and insurance, say so in the listing text.",
  ],
  cook: [
    "Guests search for food, not \"chef services\". Name the cuisine and two or three signature dishes.",
    "Say what's included: the shopping, the ingredients, the clean-up, and for how many guests.",
    "Describe each food photo with the dish's name.",
  ],
  errand: [
    "Be specific: \"holiday nanny in {area}, evenings\" or \"laundry back in 24 hours\".",
    "Mention languages, years of experience and first-aid training if they're true.",
    "Never put a carer's name or face in titles or photo text. Home help and childcare stay private.",
  ],
  experience: [
    "Use the place names guests type: Kisite, Wasini, Mida Creek, Fort Jesus, Marafa.",
    "Put the start time, how long it takes, the group size and what's included in the first lines.",
    "Show the price per person in KSh and that guests pay by M-Pesa. The big sites show dollars.",
    "Offer private and shared options. \"Private dhow cruise {area}\" is a search of its own.",
    "Ask for a review after every trip. Tripadvisor wins on review counts.",
  ],
};

export function seoCompetitorsFor(kind: PublicListingKind, areaName: string) {
  const fill = (value: string) => value.replace(/\{area\}/g, areaName);
  return {
    competitors: competitors[kind].map((competitor) => ({ name: competitor.name, where: fill(competitor.where) })),
    howToWin: beatThem[kind].map(fill),
  };
}

// ── Titles, descriptions, photo text ─────────────────────────────────────

function clipText(value: string, limit: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,.;:\s]+$/, "")}…`;
}

export function capitalise(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function listingFacts(input: SeoListingInput) {
  if (input.kind === "stay" && input.stay) {
    if (input.stay.hotel) return [input.stay.starRating ? `${input.stay.starRating}-star hotel` : "Hotel", input.stay.bedrooms ? `${input.stay.bedrooms} rooms` : null];
    return [input.stay.bedrooms ? `${input.stay.bedrooms} bedroom${input.stay.bedrooms === 1 ? "" : "s"}` : null, input.stay.maxGuests ? `sleeps ${input.stay.maxGuests}` : null];
  }
  if (input.kind === "car" && input.car) {
    return [input.name !== "Car" ? input.name : null, input.car.seats ? `${input.car.seats} seats` : null, input.car.selfDrive ? "with a driver or self-drive" : "with a driver"];
  }
  if (input.kind === "cook" && input.cook) return [input.cook.speciality ? `${input.cook.speciality} cooking` : null, "in your villa or apartment"];
  if (input.kind === "experience" && input.experience) {
    const options = input.experience.private && input.experience.shared ? "private or shared" : input.experience.shared ? "shared group" : "private";
    return [input.experience.durationHours ? `${input.experience.durationHours} hours` : null, options, input.experience.meetingPoint ? `meet at ${input.experience.meetingPoint}` : null];
  }
  return [input.errand?.serviceName || null];
}

const cta = "Prices in KSh. Book on TBM, pay by M-Pesa or card.";
const longCta = "See prices in KSh and book on Tembea Bila Matata. Pay by M-Pesa or card.";

/** The listing's name without a trailing place ("Beachfront Villa – Diani" → "Beachfront Villa"). Home help uses the service, never a person. */
function shortListingName(input: SeoListingInput) {
  if (input.kind === "errand") return capitalise(input.errand?.serviceName || "Home help");
  const name = input.name.trim();
  const first = name.split(/\s+[–—|-]\s+/)[0]?.trim();
  return first && first.length >= 6 ? first : name;
}

const genericNameWords = new Set(["villa", "apartment", "flat", "studio", "penthouse", "cottage", "house", "home", "hotel", "room", "bedroom", "bed", "suite", "guest", "beach", "beachfront", "ocean", "sea", "view", "pool", "garden", "luxury", "private", "holiday", "stay", "car", "seater", "hire", "chef", "tour", "trip", "experience"].map(stem));

/** A name adds something to the main phrase when it is a real name ("Galu Sands Villa", "Bahari Beach Hotel"), not a description that repeats it ("Beachfront 4-Bedroom Villa with Pool"). */
function nameAddsInfo(name: string, focus: string) {
  const focusWords = new Set(words(focus));
  return words(name).some((word) => !stopWords.has(word) && !focusWords.has(word) && !genericNameWords.has(word) && !/^\d+$/.test(word));
}

export function suggestSeoDescription(input: SeoListingInput, focus: string) {
  const facts = listingFacts(input).filter((fact): fact is string => typeof fact === "string" && fact.length > 0 && !containsPhrase(focus, fact));
  const name = shortListingName(input);
  const useName = input.kind !== "errand" && nameAddsInfo(name, focus);
  const build = (withName: boolean, action = cta) => {
    const lead = withName ? `${name}: ${focus}` : capitalise(focus);
    return `${[lead, ...facts].join(", ")}. ${action}`;
  };
  // The fuller call to action when it fits; otherwise drop facts from the end,
  // then the name, until it does. The main phrase and the call to action stay.
  const roomy = build(useName, longCta);
  if (roomy.length <= seoDescriptionLimit) return roomy;
  let description = build(useName);
  while (description.length > seoDescriptionLimit && facts.length) {
    facts.pop();
    description = build(useName);
  }
  if (description.length > seoDescriptionLimit) description = build(false);
  return clipText(description, seoDescriptionLimit);
}

/** Up to three titles that fit Google's width whole: never cut off with "…". */
export function suggestSeoTitles(input: SeoListingInput, focus: string) {
  const Focus = capitalise(focus);
  const fullName = input.kind === "errand" ? shortListingName(input) : input.name.trim();
  const name = shortListingName(input);
  const addsInfo = nameAddsInfo(name, focus);
  const firstFact = listingFacts(input).find((fact): fact is string => typeof fact === "string" && fact.length > 0 && !containsPhrase(focus, fact));
  const options = [
    ...(addsInfo ? [`${Focus} | ${fullName}`, `${Focus} | ${name}`, `${name} | ${Focus}`] : []),
    ...(firstFact ? [`${Focus}, ${firstFact} | ${name}`, withSeoBrand(`${Focus}, ${firstFact}`)] : []),
    `${Focus} | ${name}`,
    withSeoBrand(Focus),
  ];
  const fitted = Array.from(new Set(options.filter((option) => option.length >= 20 && option.length <= seoTitleLimit)));
  return fitted.length ? fitted.slice(0, 3) : [Focus.length <= seoTitleLimit ? Focus : clipText(Focus, seoTitleLimit)];
}

/** Photo text guests and Google read: what the listing is, where, and which photo. Admin should replace it with what the photo shows. */
export function suggestPhotoAlt(input: SeoListingInput, index: number) {
  const area = listingSeoArea(input)?.name ?? (input.location.split(",")[0]?.trim() || "the Kenyan Coast");
  const noun = input.kind === "stay"
    ? stayNoun(input)
    : input.kind === "car"
      ? "car hire"
      : input.kind === "cook"
        ? "private chef"
        : input.kind === "experience"
          ? (input.experience?.type || "experience").toLowerCase()
          : "home help";
  // Home help and childcare: never a person's name in photo text.
  const label = input.kind === "errand" ? capitalise(input.errand?.serviceName || "Home help") : input.name;
  return index === 0 ? `${label}, ${noun} in ${area}` : `${label}, ${noun} in ${area}, photo ${index + 1}`;
}

export type SeoSuggestions = {
  area: { key: string; name: string } | null;
  focusKeyword: string;
  keywords: SeoKeyword[];
  titles: string[];
  description: string;
  photoAlts: Record<string, string>;
  competitors: SeoCompetitor[];
  howToWin: string[];
};

export function suggestListingSeo(input: SeoListingInput): SeoSuggestions {
  const area = listingSeoArea(input);
  const keywords = suggestSeoKeywords(input);
  const focus = keywords[0]?.phrase ?? `${input.name} in ${area?.name ?? "Mombasa"}`;
  const photoAlts: Record<string, string> = {};
  input.photos.forEach((photo, index) => { photoAlts[photo] = suggestPhotoAlt(input, index); });
  const { competitors: rivals, howToWin } = seoCompetitorsFor(input.kind, area?.name ?? "Mombasa");
  return {
    area: area ? { key: area.key, name: area.name } : null,
    focusKeyword: focus,
    keywords,
    titles: suggestSeoTitles(input, focus),
    description: suggestSeoDescription(input, focus),
    photoAlts,
    competitors: rivals,
    howToWin,
  };
}

// ── What TBM saved, and what the page uses ───────────────────────────────

export type ListingSeoOverride = {
  seoTitle: string | null;
  seoDescription: string | null;
  focusKeyword: string | null;
  keywords: string[];
  imageAlts: Record<string, string>;
};

export const emptyListingSeo: ListingSeoOverride = { seoTitle: null, seoDescription: null, focusKeyword: null, keywords: [], imageAlts: {} };

/** The public part of TBM's SEO for a listing: what the page shows search engines. Focus and keyword notes stay in admin. */
export type PublicListingSeo = { title: string | null; description: string | null; imageAlts: Record<string, string> };

export function toPublicListingSeo(override: ListingSeoOverride | null | undefined, photos: string[]): PublicListingSeo | null {
  if (!override) return null;
  const allowed = new Set(photos);
  const imageAlts: Record<string, string> = {};
  for (const [url, alt] of Object.entries(override.imageAlts ?? {})) {
    if (allowed.has(url) && alt.trim()) imageAlts[url] = alt.trim();
  }
  const title = override.seoTitle?.trim() || null;
  const description = override.seoDescription?.trim() || null;
  if (!title && !description && !Object.keys(imageAlts).length) return null;
  return { title, description, imageAlts };
}

// ── The checklist ────────────────────────────────────────────────────────

const stopWords = new Set(["a", "an", "and", "the", "in", "on", "of", "for", "to", "with", "from", "near", "at", "by", "or"]);

function stem(word: string) {
  return word.replace(/(ies)$/, "y").replace(/(es|s)$/, "");
}

function words(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter(Boolean).map(stem);
}

/** True when every meaningful word of the phrase appears in the text, in any order. */
export function containsPhrase(textValue: string, phrase: string) {
  const have = new Set(words(textValue));
  const need = words(phrase).filter((word) => !stopWords.has(word));
  return need.length > 0 && need.every((word) => have.has(word));
}

export type SeoCheckStatus = "pass" | "warn" | "fail";
export type SeoCheck = { id: string; label: string; status: SeoCheckStatus; points: number; max: number; fix: string | null };
export type SeoGrade = "Excellent" | "Good" | "Needs work" | "Poor";
export type SeoScore = { score: number; grade: SeoGrade; checks: SeoCheck[] };

export type SeoScoreInput = {
  /** What the page uses now: TBM's title if saved, else the automatic one. */
  title: string;
  description: string;
  focusKeyword: string | null;
  imageAlts: Record<string, string>;
  duplicateTitle: boolean;
};

export function seoGrade(score: number): SeoGrade {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Needs work";
  return "Poor";
}

export function scoreListingSeo(input: SeoListingInput, seo: SeoScoreInput): SeoScore {
  const checks: SeoCheck[] = [];
  const add = (id: string, label: string, max: number, status: SeoCheckStatus, fix: string | null) => {
    checks.push({ id, label, max, status, points: status === "pass" ? max : status === "warn" ? Math.round(max / 2) : 0, fix: status === "pass" ? null : fix });
  };
  const focus = seo.focusKeyword?.trim() || "";
  const area = listingSeoArea(input);
  const titleLength = seo.title.trim().length;
  const descriptionLength = seo.description.trim().length;
  const bodyWords = input.description.trim().split(/\s+/).filter(Boolean).length;
  const photos = input.photos.length;
  const described = input.photos.filter((photo) => seo.imageAlts[photo]?.trim()).length;

  add("focus", "A main search phrase is chosen", 10, focus ? "pass" : "fail", "Pick a main phrase from the suggestions.");
  add("title-length", "Title is 30 to 60 characters", 10,
    titleLength >= 30 && titleLength <= seoTitleLimit ? "pass" : titleLength >= 20 && titleLength <= 70 ? "warn" : "fail",
    titleLength > seoTitleLimit ? "Shorten the title: Google cuts it off after about 60 characters." : "Make the title longer and more specific.");
  add("title-focus", "Title contains the main phrase", 10,
    focus && containsPhrase(seo.title, focus) ? "pass" : "fail", "Put the main phrase at the start of the title.");
  add("title-area", "Title names the area", 5,
    area && area.aliases.concat(area.name.toLowerCase()).some((alias) => wordPattern(alias).test(seo.title)) ? "pass" : "fail",
    `Name the area${area ? ` (${area.name})` : ""} in the title. Most travel searches include a place.`);
  add("description-length", "Google description is 110 to 155 characters", 10,
    descriptionLength >= 110 && descriptionLength <= seoDescriptionLimit + 5 ? "pass" : descriptionLength >= 70 && descriptionLength <= 180 ? "warn" : "fail",
    descriptionLength > seoDescriptionLimit ? "Shorten it: Google cuts descriptions at about 155 characters." : "Add the key facts and a reason to book.");
  add("description-focus", "Description contains the main phrase", 5,
    focus && containsPhrase(seo.description, focus) ? "pass" : "fail", "Use the main phrase in the first sentence of the description.");
  add("body-length", "Listing text is at least 120 words", 10,
    bodyWords >= 120 ? "pass" : bodyWords >= 60 ? "warn" : "fail",
    `The listing text has ${bodyWords} words. Ask the provider to add distances, what's included and who it suits.`);
  add("body-focus", "Listing text uses the main phrase's words", 5,
    focus && containsPhrase(`${input.name} ${input.description} ${input.location}`, focus) ? "pass" : "warn",
    "The listing text doesn't back the main phrase yet. Pick a phrase the text supports, or ask the provider to describe it.");
  add("photos", "At least 6 photos", 10,
    photos >= 6 ? "pass" : photos >= 3 ? "warn" : "fail", `There ${photos === 1 ? "is 1 photo" : `are ${photos} photos`}. Listings with 6 or more get more clicks.`);
  add("photo-text", "Every photo has descriptive text", 10,
    photos > 0 && described === photos ? "pass" : described > 0 ? "warn" : "fail", "Describe what each photo shows, for example \"Pool and garden at sunset\".");
  add("reviews", "3 or more reviews, so stars can show in Google", 5,
    input.reviewCount >= 3 ? "pass" : input.reviewCount > 0 ? "warn" : "fail", "Ask recent guests for a review.");
  add("price", "A price is set", 5, input.hasPrice ? "pass" : "fail", "Add a price so Google can show it.");
  add("unique-title", "No other listing has the same title", 5, seo.duplicateTitle ? "fail" : "pass", "Make the title different from the other listing with the same one.");

  const score = checks.reduce((sum, check) => sum + check.points, 0);
  return { score, grade: seoGrade(score), checks };
}
