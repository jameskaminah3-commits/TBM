/**
 * Every page the website has: the routes in client/src/App.tsx, with ":name"
 * for a part that varies. The server answers any other address with a 404 that
 * search engines leave out. app-routes.test.ts keeps this list in step with
 * App.tsx.
 */
export const appRoutePaths = [
  "/",
  "/about",
  "/accommodation/:id",
  "/accommodation/:id/:slug",
  "/accommodations",
  "/admin/blog",
  "/admin/bookings",
  "/admin/cars/:id/edit",
  "/admin/cars/new",
  "/admin/clients",
  "/admin/cooks/:id/edit",
  "/admin/cooks/new",
  "/admin/dashboard",
  "/admin/errands/:id/edit",
  "/admin/errands/new",
  "/admin/experiences/:id/edit",
  "/admin/experiences/new",
  "/admin/fleet-applications",
  "/admin/fleet-applications/:id",
  "/admin/listing-verifications",
  "/admin/listings",
  "/admin/marketing",
  "/admin/payments",
  "/admin/providers",
  "/admin/stays/:id/edit",
  "/admin/stays/new",
  "/admin/zaina",
  "/articles",
  "/articles/:slug",
  "/auth",
  "/b/:shortType/:code",
  "/blog",
  "/blog/:slug",
  "/book/:id",
  "/book/:serviceType/:id",
  "/bookings",
  "/chef/:id",
  "/chef/:id/:slug",
  "/contact",
  "/errand/:id",
  "/errand/:id/:slug",
  "/experience/:id",
  "/experience/:id/:slug",
  "/faq",
  "/inbox",
  "/partner",
  "/partner/apply",
  "/privacy",
  "/provider/availability",
  "/provider/cars/:id/availability",
  "/provider/cars/new",
  "/provider/cooks/:id/edit",
  "/provider/cooks/new",
  "/provider/dashboard",
  "/provider/documents",
  "/provider/errands/:id/edit",
  "/provider/errands/new",
  "/provider/experiences/:id/edit",
  "/provider/experiences/new",
  "/provider/service-requests",
  "/provider/stays/:id/availability",
  "/provider/stays/new",
  "/provider/support",
  "/refund-cancellation",
  "/request-custom-service",
  "/services",
  "/services/dine",
  "/services/drive",
  "/services/experience",
  "/services/relax",
  "/terms",
  "/transport/:id",
  "/transport/:id/:slug",
  "/verify",
] as const;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// As the site's router matches them: any letter case, an optional trailing slash.
const appRoutePatterns = appRoutePaths.map((routePath) => new RegExp(
  `^${routePath
    .split("/")
    .map((segment) => (segment.startsWith(":") ? "[^/]+" : escapeRegExp(segment)))
    .join("/")}/?$`,
  "i",
));

/** Whether an address is one of the site's pages (it may still show "not found" for a missing listing). */
export function isKnownAppPath(pathname: string) {
  return appRoutePatterns.some((pattern) => pattern.test(pathname));
}
