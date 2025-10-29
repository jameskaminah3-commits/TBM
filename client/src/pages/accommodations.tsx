import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Star, MapPin, Users, Bed, Bath } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Accommodation } from "@shared/schema";

export default function Accommodations() {
  const [, setLocation] = useLocation();
  
  const { data: accommodations, isLoading } = useQuery<Accommodation[]>({
    queryKey: ["/api/accommodations"],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen py-12">
        <div className="container mx-auto px-4 md:px-8">
          <div className="mb-12">
            <Skeleton className="h-12 w-64 mb-4" />
            <Skeleton className="h-6 w-96" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="w-full aspect-[4/3]" />
                <div className="p-4 space-y-3">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-12">
      <div className="container mx-auto px-4 md:px-8">
        <div className="mb-12">
          <h1 className="font-serif text-4xl md:text-5xl font-semibold mb-4">
            Luxury Accommodations
          </h1>
          <p className="text-lg text-muted-foreground">
            Discover exceptional stays in the world's most desirable destinations
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {accommodations?.map((accommodation) => (
            <Card
              key={accommodation.id}
              className="overflow-hidden hover-elevate active-elevate-2 cursor-pointer group"
              onClick={() => setLocation(`/accommodation/${accommodation.id}`)}
              data-testid={`card-accommodation-${accommodation.id}`}
            >
              <div className="relative aspect-[4/3] overflow-hidden">
                <img
                  src={accommodation.imageUrl}
                  alt={accommodation.title}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </div>
              
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold text-lg leading-tight line-clamp-2">
                    {accommodation.title}
                  </h3>
                </div>

                <div className="flex items-center gap-1 text-sm text-muted-foreground mb-3">
                  <MapPin className="h-4 w-4" />
                  <span className="line-clamp-1">{accommodation.location}</span>
                </div>

                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
                  <div className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    <span>{accommodation.maxGuests}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Bed className="h-4 w-4" />
                    <span>{accommodation.bedrooms}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Bath className="h-4 w-4" />
                    <span>{accommodation.bathrooms}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Star className="h-4 w-4 fill-primary text-primary" />
                    <span className="font-medium">{(accommodation.rating / 10).toFixed(1)}</span>
                    <span className="text-sm text-muted-foreground">
                      ({accommodation.reviewCount})
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">${accommodation.pricePerNight}</div>
                    <div className="text-xs text-muted-foreground">per night</div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {accommodations && accommodations.length === 0 && (
          <div className="text-center py-20">
            <p className="text-lg text-muted-foreground">
              No accommodations found. Please adjust your search criteria.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
