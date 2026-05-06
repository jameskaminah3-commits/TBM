import { differenceInCalendarDays, format, isValid, parseISO } from "date-fns";
import { getMeaningfulTokens, normalizeConciergeQuery } from "@/lib/concierge-search";

export type StaySearchState = {
  destination: string;
  checkIn: string;
  checkOut: string;
  guests: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  maxPrice: number | null;
  minRating: number | null;
  features: string[];
  sort: StaySearchSort;
  query: string;
};

export type StaySearchSort = "recommended" | "price-low" | "price-high" | "rating" | "capacity";

function normalizeSearch(search: string) {
  return search.startsWith("?") ? search.slice(1) : search;
}

function readTrimmedParam(params: URLSearchParams, key: string) {
  return params.get(key)?.trim() ?? "";
}

function parsePositiveInteger(value: string) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 1 ? null : parsed;
}

export function buildStaySearchQuery(state: Partial<StaySearchState>) {
  const explicitQuery = state.query?.trim();
  if (explicitQuery) {
    return explicitQuery;
  }

  return "";
}

export function readStaySearchState(search: string): StaySearchState {
  const params = new URLSearchParams(normalizeSearch(search));
  const destination = readTrimmedParam(params, "destination");
  const checkIn = readTrimmedParam(params, "checkIn");
  const checkOut = readTrimmedParam(params, "checkOut");
  const guests = parsePositiveInteger(readTrimmedParam(params, "guests"));
  const bedrooms = parsePositiveInteger(readTrimmedParam(params, "bedrooms"));
  const bathrooms = parsePositiveInteger(readTrimmedParam(params, "bathrooms"));
  const maxPrice = parsePositiveInteger(readTrimmedParam(params, "maxPrice"));
  const minRating = parsePositiveInteger(readTrimmedParam(params, "minRating"));
  const features = params.getAll("feature").map((feature) => feature.trim()).filter(Boolean);
  const sortParam = readTrimmedParam(params, "sort") as StaySearchSort;
  const sort: StaySearchSort = ["recommended", "price-low", "price-high", "rating", "capacity"].includes(sortParam)
    ? sortParam
    : "recommended";
  const query = buildStaySearchQuery({
    destination,
    checkIn,
    checkOut,
    guests,
    bedrooms,
    bathrooms,
    maxPrice,
    minRating,
    features,
    sort,
    query: readTrimmedParam(params, "query"),
  });

  return {
    destination,
    checkIn,
    checkOut,
    guests,
    bedrooms,
    bathrooms,
    maxPrice,
    minRating,
    features,
    sort,
    query,
  };
}

export function buildStaySearchParams(state: Partial<StaySearchState>) {
  const params = new URLSearchParams();
  const destination = state.destination?.trim();
  const checkIn = state.checkIn?.trim();
  const checkOut = state.checkOut?.trim();
  const query = buildStaySearchQuery(state);
  const sort = state.sort || "recommended";

  if (destination) {
    params.set("destination", destination);
  }

  if (checkIn) {
    params.set("checkIn", checkIn);
  }

  if (checkOut) {
    params.set("checkOut", checkOut);
  }

  if (state.guests && state.guests > 0) {
    params.set("guests", String(state.guests));
  }

  if (state.bedrooms && state.bedrooms > 0) {
    params.set("bedrooms", String(state.bedrooms));
  }

  if (state.bathrooms && state.bathrooms > 0) {
    params.set("bathrooms", String(state.bathrooms));
  }

  if (state.maxPrice && state.maxPrice > 0) {
    params.set("maxPrice", String(state.maxPrice));
  }

  if (state.minRating && state.minRating > 0) {
    params.set("minRating", String(state.minRating));
  }

  state.features?.forEach((feature) => {
    const normalizedFeature = feature.trim();
    if (normalizedFeature) {
      params.append("feature", normalizedFeature);
    }
  });

  if (sort !== "recommended") {
    params.set("sort", sort);
  }

  if (query) {
    params.set("query", query);
  }

  return params.toString();
}

export function hasStructuredStayFilters(state: StaySearchState) {
  return Boolean(
    state.destination ||
      state.checkIn ||
      state.checkOut ||
      state.guests ||
      state.bedrooms ||
      state.bathrooms ||
      state.maxPrice ||
      state.minRating ||
      state.features.length ||
      state.sort !== "recommended",
  );
}

export function formatStaySearchDate(value: string) {
  if (!value) {
    return "";
  }

  const parsed = parseISO(value);
  return isValid(parsed) ? format(parsed, "MMM d") : value;
}

export function getStaySearchNights(checkIn: string, checkOut: string) {
  if (!checkIn || !checkOut) {
    return null;
  }

  const start = parseISO(checkIn);
  const end = parseISO(checkOut);
  if (!isValid(start) || !isValid(end)) {
    return null;
  }

  return Math.max(1, differenceInCalendarDays(end, start));
}

export function matchesStayDestination(location: string, destination: string) {
  const destinationTokens = getMeaningfulTokens(destination);
  if (!destinationTokens.length) {
    return true;
  }

  const normalizedLocation = normalizeConciergeQuery(location);
  return destinationTokens.every((token) => normalizedLocation.includes(token));
}

export function toSearchSuffix(search: string) {
  if (!search) {
    return "";
  }

  return search.startsWith("?") ? search : `?${search}`;
}
