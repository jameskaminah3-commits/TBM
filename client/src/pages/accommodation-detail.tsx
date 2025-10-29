import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Star, MapPin, Users, Bed, Bath, Wifi, Car, ChefHat, ShoppingBag, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import type { Accommodation } from "@shared/schema";

export default function AccommodationDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  
  const { data: accommodation, isLoading } = useQuery<Accommodation>({
    queryKey: ["/api/accommodations", id],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen py-12">
        <div className="container mx-auto px-4 md:px-8 max-w-6xl">
          <Skeleton className="w-full aspect-[16/9] rounded-xl mb-8" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <Skeleton className="h-12 w-3/4" />
              <Skeleton className="h-32 w-full" />
            </div>
            <div>
              <Skeleton className="h-96 w-full" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!accommodation) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">Accommodation not found</h2>
          <Button onClick={() => setLocation("/accommodations")} data-testid="button-back">
            Back to Accommodations
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-12">
      <div className="container mx-auto px-4 md:px-8 max-w-6xl">
        {/* Hero Image */}
        <div className="relative aspect-[16/9] rounded-xl overflow-hidden mb-8">
          <img
            src={accommodation.imageUrl}
            alt={accommodation.title}
            className="w-full h-full object-cover"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-8">
            <div>
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h1 className="font-serif text-3xl md:text-4xl font-semibold mb-2">
                    {accommodation.title}
                  </h1>
                  <div className="flex items-center gap-4 text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <MapPin className="h-4 w-4" />
                      <span>{accommodation.location}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Star className="h-4 w-4 fill-primary text-primary" />
                      <span className="font-medium">{accommodation.rating / 10}</span>
                      <span className="text-sm">({accommodation.reviewCount} reviews)</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6 mb-6">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <span>{accommodation.maxGuests} guests</span>
                </div>
                <div className="flex items-center gap-2">
                  <Bed className="h-5 w-5 text-muted-foreground" />
                  <span>{accommodation.bedrooms} bedrooms</span>
                </div>
                <div className="flex items-center gap-2">
                  <Bath className="h-5 w-5 text-muted-foreground" />
                  <span>{accommodation.bathrooms} bathrooms</span>
                </div>
              </div>

              <Separator className="my-6" />

              <div>
                <h2 className="text-xl font-semibold mb-3">About this place</h2>
                <p className="text-muted-foreground leading-relaxed">
                  {accommodation.description}
                </p>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">Amenities</h2>
              <div className="grid grid-cols-2 gap-3">
                {accommodation.amenities.map((amenity, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <span className="text-sm">{amenity}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">Available Services</h2>
              <p className="text-muted-foreground mb-4">
                Enhance your stay with our curated local services. Select add-ons during booking.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Car className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium mb-1">Car Rental</div>
                      <div className="text-sm text-muted-foreground">
                        With or without driver
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <ChefHat className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium mb-1">Personal Chef</div>
                      <div className="text-sm text-muted-foreground">
                        In-home dining experience
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <ShoppingBag className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium mb-1">Shopping Service</div>
                      <div className="text-sm text-muted-foreground">
                        Pre-arrival grocery stocking
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium mb-1">Errand Services</div>
                      <div className="text-sm text-muted-foreground">
                        Local assistance
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>

          {/* Booking Sidebar */}
          <div className="lg:sticky lg:top-24 h-fit">
            <Card className="p-6">
              <div className="mb-6">
                <div className="text-3xl font-semibold mb-1">
                  ${accommodation.pricePerNight}
                </div>
                <div className="text-sm text-muted-foreground">per night</div>
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={() => setLocation(`/book/${accommodation.id}`)}
                data-testid="button-book-now"
              >
                Book Now
              </Button>

              <Separator className="my-6" />

              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Free cancellation up to 48 hours</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>24/7 customer support</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Verified service providers</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Clear SLA agreements</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
