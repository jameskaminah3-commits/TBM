import { queryClient } from "./queryClient";

// A page's main data, asked for as soon as the app starts rather than after the
// page's own code has arrived, so the two downloads run side by side. The keys
// match the pages' own queries, which then pick up the same request.
export function prefetchRouteData(pathname: string) {
  const stay = pathname.match(/^\/accommodation\/([^/]+)/);
  if (stay) {
    void queryClient.prefetchQuery({ queryKey: ["/api/stays", stay[1]] });
    return;
  }

  if (pathname === "/" || pathname === "/accommodations") {
    void queryClient.prefetchQuery({ queryKey: ["/api/stays"], staleTime: 5 * 60_000 });
  }
}
