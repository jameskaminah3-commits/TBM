import { useLocation, Link } from "wouter";
import { Search, MapPin, Calendar, Users, Home as HomeIcon, Car, ChefHat, ShoppingBag, CheckCircle2 } from "lucide-react";
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
          <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl font-semibold text-white mb-6 leading-tight">
            Stay + Drive + Dine + Relax<br />
            <span className="text-3xl md:text-4xl lg:text-5xl">— All in One Place</span>
          </h1>
          <p className="text-lg md:text-xl text-white/90 mb-12 max-w-2xl mx-auto leading-relaxed">
            Travel Local. Stay Easy. Live Bila Matata.
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

      {/* Service Icons Section */}
      <section className="py-16 md:py-20 bg-muted/30">
        <div className="container mx-auto px-4 md:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12 max-w-4xl mx-auto">
            <Link href="/accommodations" data-testid="service-icon-stay">
              <div className="text-center hover-elevate cursor-pointer rounded-lg p-4 transition-all">
                <div className="w-20 h-20 mx-auto mb-4 flex items-center justify-center">
                  <HomeIcon className="w-16 h-16 text-primary" strokeWidth={1.5} />
                </div>
                <h3 className="text-lg font-semibold">Stay</h3>
              </div>
            </Link>

            <Link href="/services/drive" data-testid="service-icon-drive">
              <div className="text-center hover-elevate cursor-pointer rounded-lg p-4 transition-all">
                <div className="w-20 h-20 mx-auto mb-4 flex items-center justify-center">
                  <Car className="w-16 h-16 text-primary" strokeWidth={1.5} />
                </div>
                <h3 className="text-lg font-semibold">Drive</h3>
              </div>
            </Link>

            <Link href="/services/dine" data-testid="service-icon-dine">
              <div className="text-center hover-elevate cursor-pointer rounded-lg p-4 transition-all">
                <div className="w-20 h-20 mx-auto mb-4 flex items-center justify-center">
                  <ChefHat className="w-16 h-16 text-primary" strokeWidth={1.5} />
                </div>
                <h3 className="text-lg font-semibold">Dine</h3>
              </div>
            </Link>

            <Link href="/services/relax" data-testid="service-icon-relax">
              <div className="text-center hover-elevate cursor-pointer rounded-lg p-4 transition-all">
                <div className="w-20 h-20 mx-auto mb-4 flex items-center justify-center">
                  <ShoppingBag className="w-16 h-16 text-primary" strokeWidth={1.5} />
                </div>
                <h3 className="text-lg font-semibold">Relax</h3>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center mb-16">
            <h2 className="font-serif text-4xl md:text-5xl font-semibold mb-4">How It Works</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 max-w-5xl mx-auto">
            <div className="text-center">
              <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-6">
                <MapPin className="h-10 w-10 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Choose a Stay</h3>
              <p className="text-muted-foreground">
                Browse our curated selection of premium accommodations in your desired destination
              </p>
            </div>

            <div className="text-center">
              <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="h-10 w-10 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Add Your Services</h3>
              <p className="text-muted-foreground">
                Select from car rentals, personal chefs, and local errand services to enhance your stay
              </p>
            </div>

            <div className="text-center">
              <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="h-10 w-10 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Pay Securely</h3>
              <p className="text-muted-foreground">
                Complete your booking with one secure payment for accommodation and all services
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-20 md:py-24 bg-muted/30">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center mb-16">
            <h2 className="font-serif text-4xl md:text-5xl font-semibold mb-4">Why Tembea Bila Matata</h2>
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
