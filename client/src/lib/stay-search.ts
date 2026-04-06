import { differenceInCalendarDays, format, isValid, parseISO } from "date-fns";
import { getMeaningfulTokens, normalizeConciergeQuery } from "@/lib/concierge-search";

export type StaySearchState = {
  destination: string;
  checkIn: string;
  checkOut: string;
  guests: number | null;
  query: string;
};

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

  return [
    state.destination?.trim() || "",
    state.guests && state.guests > 0 ? `${state.guests} guests` : "",
  ].filter(Boolean).join(" ");
}

export function readStaySearchState(search: string): StaySearchState {
  const params = new URLSearchParams(normalizeSearch(search));
  const destination = readTrimmedParam(params, "destination");
  const checkIn = readTrimmedParam(params, "checkIn");
  const checkOut = readTrimmedParam(params, "checkOut");
  const guests = parsePositiveInteger(readTrimmedParam(params, "guests"));
  const query = buildStaySearchQuery({
    destination,
    checkIn,
    checkOut,
    guests,
    query: readTrimmedParam(params, "query"),
  });

  return {
    destination,
    checkIn,
    checkOut,
    guests,
    query,
  };
}

export function buildStaySearchParams(state: Partial<StaySearchState>) {
  const params = new URLSearchParams();
  const destination = state.destination?.trim();
  const checkIn = state.checkIn?.trim();
  const checkOut = state.checkOut?.trim();
  const query = buildStaySearchQuery(state);

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

  if (query) {
    params.set("query", query);
  }

  return params.toString();
}

export function hasStructuredStayFilters(state: StaySearchState) {
  return Boolean(state.destination || state.checkIn || state.checkOut || state.guests);
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
