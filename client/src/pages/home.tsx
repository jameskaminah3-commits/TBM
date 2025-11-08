import { useLocation, Link } from "wouter";
import { Search, MapPin, Calendar, Users, Home as HomeIcon, Car, ChefHat, ShoppingBag, CheckCircle2, Phone, Mail, Instagram, Facebook, Twitter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/60 to-black/75" />
        
        <div className="relative z-10 container mx-auto px-4 md:px-8 text-center">
          <h1 className="font-serif text-4xl md:text-5xl lg:text-7xl font-semibold text-white mb-6 leading-tight">
            Tembea Bila Matata
          </h1>
          <p className="font-serif text-2xl md:text-3xl lg:text-4xl text-white/95 mb-4">
            Travel Without Worries
          </p>
          <p className="text-lg md:text-xl text-white/90 mb-12 max-w-2xl mx-auto leading-relaxed">
            Stays, Cars, Cooks, and Errands — all in one place
          </p>

          <Button
            size="lg"
            className="bg-accent hover:bg-accent/90 text-white px-8 py-6 text-lg rounded-xl shadow-xl hover:shadow-2xl transition-all hover:scale-105 mb-16"
            onClick={() => setLocation("/accommodations")}
            data-testid="button-explore-services"
          >
            Explore Services
          </Button>

          {/* Search Widget */}
          <Card className="max-w-4xl mx-auto p-6 md:p-8 bg-card/95 backdrop-blur-md border-none shadow-2xl rounded-2xl">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div className="md:col-span-1">
                <div className="text-sm font-medium mb-2 text-muted-foreground">Destination</div>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Where to?"
                    className="pl-10 rounded-lg"
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
                    className="pl-10 rounded-lg"
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
                    className="pl-10 rounded-lg"
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
                    className="pl-10 rounded-lg"
                    data-testid="input-guests"
                  />
                </div>
              </div>
            </div>

            <Button
              className="w-full rounded-lg"
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

      {/* Service Cards Section */}
      <section className="py-20 md:py-24 bg-background">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center mb-16">
            <h2 className="font-serif text-3xl md:text-4xl lg:text-5xl font-semibold mb-4">Our Services</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Everything you need for a perfect coastal getaway
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8 max-w-7xl mx-auto">
            {/* Stay Card */}
            <Link href="/accommodations" data-testid="service-card-stay">
              <Card className="group cursor-pointer overflow-hidden rounded-2xl border-2 shadow-md hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 h-full">
                <div className="p-8">
                  <div className="w-20 h-20 mx-auto mb-6 flex items-center justify-center rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors">
                    <HomeIcon className="w-10 h-10 text-primary" strokeWidth={2} />
                  </div>
                  <h3 className="font-serif text-2xl font-semibold mb-3 text-center">Stays</h3>
                  <p className="text-muted-foreground text-center leading-relaxed">
                    Luxury beachfront villas and coastal accommodations
                  </p>
                </div>
              </Card>
            </Link>

            {/* Drive Card */}
            <Link href="/services/drive" data-testid="service-card-drive">
              <Card className="group cursor-pointer overflow-hidden rounded-2xl border-2 shadow-md hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 h-full">
                <div className="p-8">
                  <div className="w-20 h-20 mx-auto mb-6 flex items-center justify-center rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors">
                    <Car className="w-10 h-10 text-primary" strokeWidth={2} />
                  </div>
                  <h3 className="font-serif text-2xl font-semibold mb-3 text-center">Drive</h3>
                  <p className="text-muted-foreground text-center leading-relaxed">
                    Self-drive and chauffeur car rental services
                  </p>
                </div>
              </Card>
            </Link>

            {/* Dine Card */}
            <Link href="/services/dine" data-testid="service-card-dine">
              <Card className="group cursor-pointer overflow-hidden rounded-2xl border-2 shadow-md hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 h-full">
                <div className="p-8">
                  <div className="w-20 h-20 mx-auto mb-6 flex items-center justify-center rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors">
                    <ChefHat className="w-10 h-10 text-primary" strokeWidth={2} />
                  </div>
                  <h3 className="font-serif text-2xl font-semibold mb-3 text-center">Dine</h3>
                  <p className="text-muted-foreground text-center leading-relaxed">
                    Personal chefs and authentic local cuisine
                  </p>
                </div>
              </Card>
            </Link>

            {/* Relax Card */}
            <Link href="/services/relax" data-testid="service-card-relax">
              <Card className="group cursor-pointer overflow-hidden rounded-2xl border-2 shadow-md hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 h-full">
                <div className="p-8">
                  <div className="w-20 h-20 mx-auto mb-6 flex items-center justify-center rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors">
                    <ShoppingBag className="w-10 h-10 text-primary" strokeWidth={2} />
                  </div>
                  <h3 className="font-serif text-2xl font-semibold mb-3 text-center">Relax</h3>
                  <p className="text-muted-foreground text-center leading-relaxed">
                    Shopping, errands, and personal assistance
                  </p>
                </div>
              </Card>
            </Link>
          </div>
        </div>
      </section>

      {/* Why Tembea Bila Matata Section */}
      <section className="py-20 md:py-24 bg-muted/30">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center mb-16">
            <h2 className="font-serif text-3xl md:text-4xl lg:text-5xl font-semibold mb-4">
              Why Tembea Bila Matata
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Experience the perfect blend of luxury and convenience
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 md:gap-10 max-w-6xl mx-auto">
            <div className="text-center">
              <div className="w-20 h-20 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="h-10 w-10 text-primary" />
              </div>
              <h3 className="font-serif text-xl font-semibold mb-3">Verified Local Stays</h3>
              <p className="text-muted-foreground leading-relaxed">
                Hand-picked accommodations verified for quality and authenticity
              </p>
            </div>

            <div className="text-center">
              <div className="w-20 h-20 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="h-10 w-10 text-primary" />
              </div>
              <h3 className="font-serif text-xl font-semibold mb-3">Reliable Cars</h3>
              <p className="text-muted-foreground leading-relaxed">
                Well-maintained vehicles with professional drivers available
              </p>
            </div>

            <div className="text-center">
              <div className="w-20 h-20 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="h-10 w-10 text-primary" />
              </div>
              <h3 className="font-serif text-xl font-semibold mb-3">Authentic Local Cooks</h3>
              <p className="text-muted-foreground leading-relaxed">
                Expert chefs bringing you the finest coastal cuisine
              </p>
            </div>

            <div className="text-center">
              <div className="w-20 h-20 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="h-10 w-10 text-primary" />
              </div>
              <h3 className="font-serif text-xl font-semibold mb-3">Stress-Free Errands</h3>
              <p className="text-muted-foreground leading-relaxed">
                Personal assistance for shopping and daily tasks
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 md:py-24 bg-background">
        <div className="container mx-auto px-4 md:px-8 text-center">
          <h2 className="font-serif text-3xl md:text-4xl lg:text-5xl font-semibold mb-6">
            Ready for Your Coastal Escape?
          </h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Book your perfect stay with all the services you need
          </p>
          <Button 
            size="lg" 
            className="bg-accent hover:bg-accent/90 text-white px-8 py-6 text-lg rounded-xl shadow-lg hover:shadow-xl transition-all hover:scale-105"
            onClick={() => setLocation("/accommodations")} 
            data-testid="button-cta"
          >
            Explore Accommodations
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-muted/30 border-t py-12">
        <div className="container mx-auto px-4 md:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12 max-w-6xl mx-auto">
            {/* Brand */}
            <div>
              <h3 className="font-serif text-2xl font-semibold mb-3">Tembea Bila Matata</h3>
              <p className="text-muted-foreground mb-4">
                Travel Without Worries
              </p>
              <p className="text-sm text-muted-foreground">
                Stays, Cars, Cooks, and Errands — all in one place
              </p>
            </div>

            {/* Contact */}
            <div>
              <h4 className="font-serif text-lg font-semibold mb-4">Get in Touch</h4>
              <div className="space-y-3">
                <a 
                  href="https://wa.me/254700000000" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center text-muted-foreground hover:text-primary transition-colors"
                  data-testid="link-whatsapp"
                >
                  <Phone className="h-4 w-4 mr-2" />
                  WhatsApp
                </a>
                <a 
                  href="mailto:hello@tembea.com"
                  className="flex items-center text-muted-foreground hover:text-primary transition-colors"
                  data-testid="link-email"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  hello@tembea.com
                </a>
              </div>
            </div>

            {/* Social */}
            <div>
              <h4 className="font-serif text-lg font-semibold mb-4">Follow Us</h4>
              <div className="flex space-x-4">
                <a 
                  href="#" 
                  className="w-10 h-10 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary transition-colors"
                  data-testid="link-instagram"
                  aria-label="Instagram"
                >
                  <Instagram className="h-5 w-5" />
                </a>
                <a 
                  href="#" 
                  className="w-10 h-10 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary transition-colors"
                  data-testid="link-facebook"
                  aria-label="Facebook"
                >
                  <Facebook className="h-5 w-5" />
                </a>
                <a 
                  href="#" 
                  className="w-10 h-10 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary transition-colors"
                  data-testid="link-twitter"
                  aria-label="Twitter"
                >
                  <Twitter className="h-5 w-5" />
                </a>
              </div>
            </div>
          </div>

          <div className="border-t mt-8 pt-8 text-center">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} Tembea Bila Matata. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
