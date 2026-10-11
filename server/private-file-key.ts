// Links to protected files: "/api/files/<key>". Keys are made by the server
// (kind/month/random) and checked before any use, so a link can't reach
// outside private storage.
export const PRIVATE_FILE_ROUTE = "/api/files/";
const keyPattern = /^(vehicle-document|fleet-application|guest-attachment|quarantine)\/[A-Za-z0-9._\-/]+$/;

export function privateFileUrl(key: string) {
  return `${PRIVATE_FILE_ROUTE}${key}`;
}

export function isPrivateFileKey(key: string) {
  return keyPattern.test(key) && !key.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

// "/api/files/<key>" (or the same on any http(s) host) → the key, if well formed.
export function privateFileKeyFromUrl(url: string | null | undefined): string | null {
  const value = url?.trim();
  if (!value) {
    return null;
  }
  const index = value.indexOf(PRIVATE_FILE_ROUTE);
  if (index < 0 || (index > 0 && !/^https?:\/\/[^/]+$/.test(value.slice(0, index)))) {
    return null;
  }
  let key: string;
  try {
    key = decodeURIComponent(value.slice(index + PRIVATE_FILE_ROUTE.length).split(/[?#]/)[0]);
  } catch {
    return null;
  }
  return isPrivateFileKey(key) ? key : null;
}
