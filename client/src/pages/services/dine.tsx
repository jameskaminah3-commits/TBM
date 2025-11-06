import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChefHat, Clock, Utensils } from "lucide-react";
import type { Service } from "@shared/schema";

export default function DinePage() {
  const [, setLocation] = useLocation();
  const { data: services, isLoading } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const chefServices = services?.filter(s => s.type === "personal-cook") || [];

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
            {chefServices.map((service) => (
              <Card
                key={service.id}
                className="p-6 hover-elevate cursor-pointer"
                data-testid={`card-service-${service.id}`}
              >
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-16 h-16 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <ChefHat className="h-8 w-8 text-primary" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold mb-2">{service.name}</h3>
                    <div className="flex flex-wrap gap-2 mb-3">
                      <Badge variant="secondary" className="text-xs">
                        {service.priceType === "per-day" ? "Daily Service" : "One-Time Event"}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        <Utensils className="h-3 w-3 mr-1" />
                        Gourmet
                      </Badge>
                    </div>
                  </div>
                </div>

                <p className="text-muted-foreground mb-4">
                  {service.description}
                </p>

                <div className="flex items-center gap-2 text-sm mb-4">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>Custom scheduling available</span>
                </div>

                <div className="flex items-center justify-between pt-4 border-t">
                  <div>
                    <p className="text-2xl font-semibold">${service.pricePerDay}</p>
                    <p className="text-sm text-muted-foreground">
                      {service.priceType === "per-day" ? "per day" : "per event"}
                    </p>
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

          {chefServices.length === 0 && (
            <div className="text-center py-12">
              <p className="text-lg text-muted-foreground">No dine services available at the moment.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
