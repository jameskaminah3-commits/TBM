import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChefHat, Clock, Utensils, MapPin } from "lucide-react";
import type { Listing } from "@shared/schema";

export default function DinePage() {
  const [, setLocation] = useLocation();
  const { data: cooks, isLoading } = useQuery<Listing[]>({
    queryKey: ["/api/listings", "cooks"],
  });

  const cookListings = cooks || [];

  const parseFeatures = (listing: Listing) => {
    try {
      return typeof listing.features === 'string' 
        ? JSON.parse(listing.features) 
        : listing.features || {};
    } catch {
      return {};
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background py-12">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center py-20">
            <p className="text-lg text-muted-foreground">Loading services...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="py-16 md:py-20 bg-muted/30">
        <div className="container mx-auto px-4 md:px-8 text-center">
          <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl font-semibold mb-6">
            Dine Services
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
            Experience gourmet dining with our expert personal chefs. Custom menus tailored to your taste.
          </p>
        </div>
      </section>

      {/* Services Grid */}
      <section className="py-16 md:py-20">
        <div className="container mx-auto px-4 md:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {cookListings.map((listing) => {
              const features = parseFeatures(listing);
              return (
                <Card
                  key={listing.id}
                  className="overflow-hidden hover-elevate cursor-pointer"
                  data-testid={`card-service-${listing.id}`}
                >
                  {listing.imageUrl && (
                    <div className="aspect-video overflow-hidden bg-muted">
                      <img 
                        src={listing.imageUrl} 
                        alt={listing.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  
                  <div className="p-6">
                    <div className="flex items-start gap-4 mb-4">
                      <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <ChefHat className="h-6 w-6 text-primary" strokeWidth={1.5} />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-semibold mb-2">{listing.title}</h3>
                        {listing.location && (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            <span>{listing.location}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <p className="text-muted-foreground mb-4 line-clamp-3">
                      {listing.description}
                    </p>

                    {(features.cuisine || features.specialty) && (
                      <div className="flex flex-wrap gap-2 mb-4">
                        {features.cuisine && (
                          <Badge variant="secondary" className="text-xs capitalize">
                            <Utensils className="h-3 w-3 mr-1" />
                            {features.cuisine}
                          </Badge>
                        )}
                        {features.specialty && (
                          <Badge variant="outline" className="text-xs capitalize">
                            {features.specialty}
                          </Badge>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-sm mb-4">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>Custom scheduling available</span>
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t">
                      <div>
                        <p className="text-2xl font-semibold">${listing.price}</p>
                        <p className="text-sm text-muted-foreground">per day</p>
                      </div>
                      <Button 
                        onClick={() => setLocation(`/book/listing/${listing.id}`)}
                        data-testid={`button-book-${listing.id}`}
                      >
                        Book Now
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {cookListings.length === 0 && (
            <div className="text-center py-12">
              <p className="text-lg text-muted-foreground">No dine services available at the moment.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
