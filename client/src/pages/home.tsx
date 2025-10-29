import { useLocation } from "wouter";
import { Search, MapPin, Calendar, Users, Star, Car, ChefHat, ShoppingBag, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import heroImage from "@assets/generated_images/Luxury_beachfront_villa_hero_b917e1ae.png";

export default function Home() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${heroImage})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/50 to-black/70" />
        
        <div className="relative z-10 container mx-auto px-4 md:px-8 text-center">
          <h1 className="font-serif text-5xl md:text-6xl lg:text-7xl font-semibold text-white mb-6 leading-tight">
            Your Home Away<br />From Home
          </h1>
          <p className="text-lg md:text-xl text-white/90 mb-12 max-w-2xl mx-auto leading-relaxed">
            Luxury accommodations paired with vetted local services.<br />
            One booking. One payment. Unforgettable experiences.
          </p>

          {/* Search Widget */}
          <Card className="max-w-4xl mx-auto p-6 md:p-8 bg-background/95 backdrop-blur-sm border-none">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div className="md:col-span-1">
                <div className="text-sm font-medium mb-2 text-muted-foreground">Destination</div>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Where to?"
                    className="pl-10"
                    data-testid="input-destination"
                  />
                </div>
              </div>
              
              <div>
                <div className="text-sm font-medium mb-2 text-muted-foreground">Check in</div>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="date"
                    className="pl-10"
                    data-testid="input-checkin"
                  />
                </div>
              </div>

              <div>
                <div className="text-sm font-medium mb-2 text-muted-foreground">Check out</div>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="date"
                    className="pl-10"
                    data-testid="input-checkout"
                  />
                </div>
              </div>

              <div>
                <div className="text-sm font-medium mb-2 text-muted-foreground">Guests</div>
                <div className="relative">
                  <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="number"
                    placeholder="2"
                    min="1"
                    className="pl-10"
                    data-testid="input-guests"
                  />
                </div>
              </div>
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={() => setLocation("/accommodations")}
              data-testid="button-search"
            >
              <Search className="mr-2 h-5 w-5" />
              Search Accommodations
            </Button>
          </Card>
        </div>
      </section>

      {/* Services Section */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center mb-16">
            <h2 className="font-serif text-4xl md:text-5xl font-semibold mb-4">Curated Local Services</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Enhance your stay with our vetted network of local providers, all managed with clear service-level agreements
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card className="p-6 hover-elevate cursor-pointer" data-testid="card-service-car">
              <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                <Car className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Car Rentals</h3>
              <p className="text-muted-foreground mb-4">
                Self-drive or chauffeur-driven vehicles. Premium fleet with insurance and 24/7 support.
              </p>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">From $50/day</Badge>
                <Badge variant="outline" className="text-xs">24hr Response</Badge>
              </div>
            </Card>

            <Card className="p-6 hover-elevate cursor-pointer" data-testid="card-service-chef">
              <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                <ChefHat className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Personal Chefs</h3>
              <p className="text-muted-foreground mb-4">
                Experienced chefs for in-home dining. Custom menus tailored to your preferences.
              </p>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">From $150/meal</Badge>
                <Badge variant="outline" className="text-xs">Verified</Badge>
              </div>
            </Card>

            <Card className="p-6 hover-elevate cursor-pointer" data-testid="card-service-errands">
              <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                <ShoppingBag className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Errand Services</h3>
              <p className="text-muted-foreground mb-4">
                Shopping, fridge stocking, and local errands. Arrive to a fully prepared home.
              </p>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">From $30/service</Badge>
                <Badge variant="outline" className="text-xs">Same-day</Badge>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-20 md:py-24 bg-muted/30">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center mb-16">
            <h2 className="font-serif text-4xl md:text-5xl font-semibold mb-4">Why Luxescape</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              We bridge the gap between Airbnb convenience and hotel-style concierge service
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="h-8 w-8 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Vetted Providers</h3>
              <p className="text-sm text-muted-foreground">
                Background-checked and quality-assured service professionals
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="h-8 w-8 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Clear SLAs</h3>
              <p className="text-sm text-muted-foreground">
                Transparent service-level agreements for every booking
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="h-8 w-8 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Single Payment</h3>
              <p className="text-sm text-muted-foreground">
                One checkout for accommodation and all services combined
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="h-8 w-8 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">24/7 Support</h3>
              <p className="text-sm text-muted-foreground">
                Around-the-clock assistance for your peace of mind
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-4 md:px-8 text-center">
          <h2 className="font-serif text-4xl md:text-5xl font-semibold mb-6">
            Ready for Your Next Adventure?
          </h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Discover luxury accommodations with seamless local services
          </p>
          <Button size="lg" onClick={() => setLocation("/accommodations")} data-testid="button-cta">
            Explore Accommodations
          </Button>
        </div>
      </section>
    </div>
  );
}
