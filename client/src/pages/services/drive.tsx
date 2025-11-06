import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Car, Users, Gauge, Settings } from "lucide-react";
import type { Service } from "@shared/schema";

export default function DrivePage() {
  const [, setLocation] = useLocation();
  const { data: services, isLoading } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const carRentalServices = services?.filter(s => s.type === "car-rental") || [];

  const getIcon = (vehicleType: string | null) => {
    switch (vehicleType) {
      case "suv":
      case "van":
        return <Car className="h-8 w-8 text-primary" strokeWidth={1.5} />;
      case "luxury":
        return <Car className="h-8 w-8 text-primary" strokeWidth={2} />;
      default:
        return <Car className="h-8 w-8 text-primary" strokeWidth={1.5} />;
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
            {carRentalServices.map((service) => (
              <Card
                key={service.id}
                className="p-6 hover-elevate cursor-pointer"
                data-testid={`card-service-${service.id}`}
              >
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-16 h-16 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                    {getIcon(service.vehicleType)}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold mb-2">{service.name}</h3>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {service.deliveryType && (
                        <Badge variant="secondary" className="text-xs">
                          {service.deliveryType === "self-driven" ? "Self-Drive" : "Chauffeur"}
                        </Badge>
                      )}
                      {service.vehicleType && (
                        <Badge variant="outline" className="text-xs capitalize">
                          {service.vehicleType}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <p className="text-muted-foreground mb-4 line-clamp-3">
                  {service.description}
                </p>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  {service.transmission && (
                    <div className="flex items-center gap-2 text-sm">
                      <Settings className="h-4 w-4 text-muted-foreground" />
                      <span className="capitalize">{service.transmission}</span>
                    </div>
                  )}
                  {service.seatingCapacity && (
                    <div className="flex items-center gap-2 text-sm">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span>{service.seatingCapacity} seats</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-4 border-t">
                  <div>
                    <p className="text-2xl font-semibold">${service.pricePerDay}</p>
                    <p className="text-sm text-muted-foreground">per day</p>
                  </div>
                  <Button 
                    onClick={() => setLocation(`/book/service/${service.id}`)}
                    data-testid={`button-book-${service.id}`}
                  >
                    Book Now
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          {carRentalServices.length === 0 && (
            <div className="text-center py-12">
              <p className="text-lg text-muted-foreground">No drive services available at the moment.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
