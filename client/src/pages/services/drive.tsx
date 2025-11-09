import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Car, Users, Gauge, Settings, MapPin } from "lucide-react";
import type { Car as CarType } from "@shared/schema";

export default function DrivePage() {
  const [, setLocation] = useLocation();
  const { data: cars, isLoading } = useQuery<CarType[]>({
    queryKey: ["/api/cars"],
  });

  const carListings = cars || [];

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
            Drive Services
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
            Choose from our fleet of premium vehicles. Self-drive or chauffeur-driven options available.
          </p>
        </div>
      </section>

      {/* Services Grid */}
      <section className="py-16 md:py-20">
        <div className="container mx-auto px-4 md:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {carListings.map((car) => {
              return (
                <Card
                  key={car.id}
                  className="overflow-hidden hover-elevate cursor-pointer"
                  data-testid={`card-service-${car.id}`}
                >
                  {car.imageUrl && (
                    <div className="aspect-video overflow-hidden bg-muted">
                      <img 
                        src={car.imageUrl} 
                        alt={car.model}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  
                  <div className="p-6">
                    <div className="flex items-start gap-4 mb-4">
                      <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Car className="h-6 w-6 text-primary" strokeWidth={1.5} />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-semibold mb-2">{car.model}</h3>
                      </div>
                    </div>

                    <p className="text-muted-foreground mb-4 line-clamp-3">
                      {car.description}
                    </p>

                    <div className="flex flex-wrap gap-2 mb-4">
                      <Badge variant="outline" className="text-xs capitalize">
                        {car.transmission}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {car.seats} seats
                      </Badge>
                      {car.features.slice(0, 2).map((feature, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          {feature}
                        </Badge>
                      ))}
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t">
                      <div>
                        <p className="text-2xl font-semibold">${car.pricePerDay}</p>
                        <p className="text-sm text-muted-foreground">per day</p>
                        {car.priceWithDriver && (
                          <p className="text-sm text-muted-foreground mt-1">
                            ${car.priceWithDriver}/day with driver
                          </p>
                        )}
                      </div>
                      <Button 
                        onClick={() => setLocation(`/book/car/${car.id}`)}
                        data-testid={`button-book-${car.id}`}
                      >
                        Book Now
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {carListings.length === 0 && (
            <div className="text-center py-12">
              <p className="text-lg text-muted-foreground">No drive services available at the moment.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
