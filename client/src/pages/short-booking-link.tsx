import { useEffect, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  getCanonicalBookingPath,
  serviceByShortType,
  type ShareServiceType,
} from "@/lib/share-links";

type PublicListing = {
  id: string;
};

const endpointByService: Record<ShareServiceType, string> = {
  stay: "/api/stays",
  car: "/api/cars",
  cook: "/api/cooks",
  errand: "/api/errands",
  experience: "/api/experiences",
};

export default function ShortBookingLink() {
  const { shortType = "", code = "" } = useParams<{ shortType: string; code: string }>();
  const [, setLocation] = useLocation();
  const serviceType = serviceByShortType[shortType.toLowerCase()];
  const normalizedCode = code.trim().toLowerCase();

  const { data: listings = [], isLoading } = useQuery<PublicListing[]>({
    queryKey: ["short-share-link", serviceType],
    enabled: Boolean(serviceType && normalizedCode),
    queryFn: async () => {
      const response = await fetch(endpointByService[serviceType], { credentials: "include" });
      if (!response.ok) {
        throw new Error("Could not resolve this share link");
      }
      return response.json();
    },
  });

  const matchingListing = useMemo(
    () => listings.find((listing) => listing.id.toLowerCase().startsWith(normalizedCode)),
    [listings, normalizedCode],
  );

  useEffect(() => {
    if (!serviceType || !normalizedCode || isLoading || !matchingListing) {
      return;
    }

    setLocation(getCanonicalBookingPath(serviceType, matchingListing.id), { replace: true });
  }, [isLoading, matchingListing, normalizedCode, serviceType, setLocation]);

  if (!serviceType || !normalizedCode || (!isLoading && !matchingListing)) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl items-center px-6 py-16">
        <Card className="w-full space-y-4 border-stone-200 p-6 text-center">
          <h1 className="font-serif text-2xl text-foreground">Share link not found</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            This listing may be private, still under review, or the link may have been copied incorrectly.
          </p>
          <Button type="button" onClick={() => setLocation("/")}>
            Go Home
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl items-center px-6 py-16">
      <Card className="w-full space-y-3 border-stone-200 p-6 text-center">
        <h1 className="font-serif text-2xl text-foreground">Opening booking page</h1>
        <p className="text-sm text-muted-foreground">One moment while we prepare this service.</p>
      </Card>
    </main>
  );
}
