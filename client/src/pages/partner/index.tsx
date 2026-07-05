import { Link } from "wouter";
import {
  ArrowRight,
  Calendar,
  Car,
  DollarSign,
  Handshake,
  Headphones,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import heroImage from "@assets/generated_images/Fleet_lineup_coastal_resort_9f3a2c1d.jpg";
import iconSedan from "@assets/generated_images/Fleet_icon_sedan_5d2f7a3e.jpg";
import iconSuv from "@assets/generated_images/Fleet_icon_suv_8a4c1b6f.jpg";
import iconVan from "@assets/generated_images/Fleet_icon_van_3f7e9d2c.jpg";
import iconSafari from "@assets/generated_images/Fleet_icon_safari_6b1a8e4d.jpg";
import iconExecutive from "@assets/generated_images/Fleet_icon_executive_9c3d5f81.jpg";

const trustPoints = [
  { icon: ShieldCheck, label: "Vehicle verification required" },
  { icon: Handshake, label: "Professional partnership agreement" },
  { icon: DollarSign, label: "No joining fee" },
];

const whyJoin = [
  { icon: Users, title: "Premium Guests", description: "Serve local and international travellers." },
  { icon: Calendar, title: "Flexible Opportunities", description: "Your vehicle is matched to suitable requests." },
  { icon: Headphones, title: "Professional Coordination", description: "We manage guest communication and bookings." },
  { icon: TrendingUp, title: "Growing Network", description: "Become part of a trusted coastal travel brand." },
];

const suitableFor = [
  { image: iconSedan, label: "Individuals with one vehicle" },
  { image: iconSuv, label: "Investors growing a fleet" },
  { image: iconVan, label: "Existing car hire businesses" },
  { image: iconSafari, label: "Tour vehicle owners" },
  { image: iconExecutive, label: "Executive transport providers" },
];

export default function PartnerLanding() {
  const heroContent = (
    <>
      <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-white/90 backdrop-blur-sm">
        <Car className="h-3.5 w-3.5" />
        Trusted Fleet Network
      </span>
      <h1 className="mt-6 font-serif text-[2.35rem] font-medium leading-[1.05] text-white sm:text-5xl lg:text-6xl">
        Put Your Vehicle to Work with Tembea Bila Matata
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-balance text-base leading-7 text-white/85 sm:text-lg">
        Own a vehicle? Join our trusted fleet network and let Tembea Bila Matata connect your vehicle with
        airport transfers, chauffeur services, self-drive rentals, tours, and other premium travel
        opportunities across the Kenyan Coast.
      </p>
      <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link href="/partner/apply">
          <Button size="lg" className="h-12 rounded-full px-8 text-base">
            Join the Fleet
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </div>
      <div className="mt-8 grid grid-cols-1 divide-y divide-white/10 rounded-2xl border border-white/10 bg-foreground/40 text-left backdrop-blur-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {trustPoints.map((point) => (
          <div key={point.label} className="flex items-center gap-3 px-5 py-4">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-primary/60 bg-white/5">
              <point.icon className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm font-medium leading-5 text-white/90">{point.label}</span>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <div className="bg-background">
      <section className="relative overflow-hidden bg-foreground">
        {/* Mobile: image shown at its own aspect ratio so the full fleet lineup is visible, content below on a solid background */}
        <div className="sm:hidden">
          <div className="aspect-[3/2] w-full overflow-hidden">
            <img src={heroImage} alt="Sedan, SUV, van, and safari vehicle lineup" className="h-full w-full object-cover" />
          </div>
          <div className="px-4 py-10 text-center">{heroContent}</div>
        </div>

        {/* sm and up: full-bleed background image with overlay */}
        <div className="relative hidden sm:block">
          <div className="absolute inset-0">
            <img src={heroImage} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-b from-foreground/80 via-foreground/60 to-foreground/85" />
          </div>
          <div className="relative mx-auto max-w-5xl px-4 py-24 text-center sm:py-32 md:px-8">{heroContent}</div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 md:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-serif text-[2rem] font-medium leading-tight sm:text-4xl">Why Join Tembea Bila Matata?</h2>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {whyJoin.map((item) => (
            <div key={item.title}>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <item.icon className="h-6 w-6 text-primary" strokeWidth={1.8} />
              </div>
              <h3 className="mt-4 font-serif text-lg font-medium leading-tight text-foreground">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 md:px-8">
        <div className="flex flex-col items-center gap-8 rounded-3xl bg-primary/10 p-8 md:flex-row md:p-10">
          <div className="flex flex-1 items-start gap-4">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <div>
              <h3 className="font-serif text-xl font-medium leading-tight text-foreground sm:text-2xl">
                You remain the owner of your vehicle.
              </h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
                Tembea Bila Matata coordinates suitable service opportunities, while each assignment is confirmed
                with you based on your availability and agreement.
              </p>
            </div>
          </div>
          <div className="flex h-32 w-full flex-shrink-0 items-center justify-center rounded-2xl bg-primary/15 md:h-full md:w-56">
            <Handshake className="h-14 w-14 text-primary" strokeWidth={1.5} />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-24 md:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-serif text-[1.75rem] font-medium leading-tight sm:text-3xl">Suitable for:</h2>
          <p className="mt-2 text-sm text-muted-foreground">Tap any category to start your application.</p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {suitableFor.map((item) => (
            <Link
              key={item.label}
              href="/partner/apply"
              className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.38)] transition-colors hover:border-primary/60 hover:bg-primary/5"
            >
              <img
                src={item.image}
                alt=""
                className="h-14 w-14 flex-shrink-0 rounded-xl object-cover"
              />
              <span className="text-sm font-medium leading-5 text-foreground">{item.label}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-20 text-center md:px-8">
        <p className="text-balance font-serif text-xl leading-8 text-foreground sm:text-2xl">
          Every vehicle in our fleet network is carefully reviewed to meet the same premium standard our guests
          expect from Tembea Bila Matata.
        </p>
        <div className="mt-10">
          <Link href="/partner/apply">
            <Button size="lg" className="h-12 rounded-full px-8 text-base">
              Join the Fleet
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
