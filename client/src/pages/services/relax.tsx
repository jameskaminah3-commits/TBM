import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShoppingBag, Package, Sparkles, ShoppingCart, MapPin } from "lucide-react";
import type { Errand } from "@shared/schema";

export default function RelaxPage() {
  const [, setLocation] = useLocation();
  const { data: errands, isLoading } = useQuery<Errand[]>({
    queryKey: ["/api/errands"],
  });

  const errandListings = errands || [];

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
            Relax Services
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
            Let us handle the errands. Shopping, fridge stocking, and personal assistance services.
          </p>
        </div>
      </section>

      {/* Services Grid */}
      <section className="py-16 md:py-20">
        <div className="container mx-auto px-4 md:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {errandListings.map((errand) => {
              return (
                <Card
                  key={errand.id}
                  className="overflow-hidden hover-elevate cursor-pointer"
                  data-testid={`card-service-${errand.id}`}
                >
                  {errand.imageUrl && (
                    <div className="aspect-video overflow-hidden bg-muted">
                      <img 
                        src={errand.imageUrl} 
                        alt={errand.serviceName}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  
                  <div className="p-6">
                    <div className="flex items-start gap-4 mb-4">
                      <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <ShoppingBag className="h-6 w-6 text-primary" strokeWidth={1.5} />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-semibold mb-2">{errand.serviceName}</h3>
                      </div>
                    </div>

                    <p className="text-muted-foreground mb-4 line-clamp-3">
                      {errand.description}
                    </p>

                    <div className="flex flex-wrap gap-2 mb-4">
                      {errand.features.slice(0, 3).map((feature, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          {feature}
                        </Badge>
                      ))}
                      {errand.features.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{errand.features.length - 3} more
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t">
                      <div>
                        <p className="text-2xl font-semibold">${errand.basePrice}</p>
                        <p className="text-sm text-muted-foreground">base price</p>
                      </div>
                      <Button 
                        onClick={() => setLocation(`/book/errand/${errand.id}`)}
                        data-testid={`button-book-${errand.id}`}
                      >
                        Book Now
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {errandListings.length === 0 && (
            <div className="text-center py-12">
              <p className="text-lg text-muted-foreground">No relax services available at the moment.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
