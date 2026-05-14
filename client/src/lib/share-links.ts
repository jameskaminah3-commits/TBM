export type ShareServiceType = "stay" | "car" | "cook" | "errand" | "experience";

const shortTypeByService: Record<ShareServiceType, string> = {
  stay: "s",
  car: "c",
  cook: "k",
  errand: "r",
  experience: "x",
};

export const serviceByShortType: Record<string, ShareServiceType> = {
  s: "stay",
  c: "car",
  k: "cook",
  r: "errand",
  x: "experience",
};

export function getShareCode(id: string) {
  return id.split("-")[0] || id.slice(0, 8);
}

export function getShortSharePath(serviceType: ShareServiceType, id: string) {
  return `/b/${shortTypeByService[serviceType]}/${getShareCode(id)}`;
}

export function getCanonicalBookingPath(serviceType: ShareServiceType, id: string) {
  return serviceType === "stay" ? `/book/${id}` : `/book/${serviceType}/${id}`;
}

export function getShortShareUrl(serviceType: ShareServiceType, id: string, origin?: string) {
  const baseUrl = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${baseUrl}${getShortSharePath(serviceType, id)}`;
}
