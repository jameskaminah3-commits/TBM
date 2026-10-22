import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, BedDouble, CarFront, Compass, MessageCircle, ShieldCheck, Sparkles, UtensilsCrossed } from "lucide-react";
import type { Stay, Car, Cook, Errand, Experience } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { ListingMedia } from "@/components/listing-media";
import { openZaina } from "@/lib/zaina";

type ServiceTile = {
  href: string;
  icon: LucideIcon;
  label: string;
  tagline: string;
  description: string;
  cta: string;
  testId: string;
  photo: string | null;
};

type WithPhoto = { imageUrl?: string | null; galleryUrls?: string[] | null };

const LISTING_QUERY = { staleTime: 5 * 60_000, refetchOnWindowFocus: false } as const;

/** A real photo from the service's own listings: the first one that has one. */
function firstPhoto(items: WithPhoto[]) {
  for (const item of items) {
    const photo = item.imageUrl || item.galleryUrls?.find(Boolean);
    if (photo) return photo;
  }
  return null;
}

export default function ServicesHub() {
  const { data: stays = [] } = useQuery<Stay[]>({ queryKey: ["/api/stays"], ...LISTING_QUERY });
  const { data: cars = [] } = useQuery<Car[]>({ queryKey: ["/api/cars"], ...LISTING_QUERY });
  const { data: cooks = [] } = useQuery<Cook[]>({ queryKey: ["/api/cooks"], ...LISTING_QUERY });
  const { data: errands = [] } = useQuery<Errand[]>({ queryKey: ["/api/errands"], ...LISTING_QUERY });
  const { data: experiences = [] } = useQuery<Experience[]>({ queryKey: ["/api/experiences"], ...LISTING_QUERY });

  const tiles: ServiceTile[] = [
    {
      href: "/accommodations",
      icon: BedDouble,
      label: "Stays",
      tagline: "Villas, apartments & hotels",
      description: "Holiday homes and hotels along the Coast, with the price for your dates before you book.",
      cta: "Browse stays",
      testId: "service-hub-stays",
      photo: firstPhoto(stays),
    },
    {
      href: "/services/drive",
      icon: CarFront,
      label: "Drive",
      tagline: "Airport transfers & car hire",
      description: "Airport and SGR pickups, a driver for the day, or a car to drive yourself.",
      cta: "See drive options",
      testId: "service-hub-drive",
      photo: firstPhoto(cars),
    },
    {
      href: "/services/dine",
      icon: UtensilsCrossed,
      label: "Dine",
      tagline: "Private chefs",
      description: "A private chef who cooks at your villa or apartment: Swahili, seafood, BBQ and more.",
      cta: "Meet the chefs",
      testId: "service-hub-dine",
      photo: firstPhoto(cooks),
    },
    {
      href: "/services/relax",
      icon: Sparkles,
      label: "Relax",
      tagline: "Errands, cleaning & childcare",
      description: "Groceries waiting when you arrive, laundry, cleaning, and a nanny for the children.",
      cta: "See relax services",
      testId: "service-hub-relax",
      photo: firstPhoto(errands),
    },
    {
      href: "/services/experience",
      icon: Compass,
      label: "Experience",
      tagline: "Days out & trips",
      description: "Dhow trips, snorkelling and days out with local guides, priced per person.",
      cta: "See experiences",
      testId: "service-hub-experience",
      photo: firstPhoto(experiences),
    },
    {
      href: "/verify",
      icon: ShieldCheck,
      label: "Verify",
      tagline: "Check a place before you pay",
      description: "Found a villa on Facebook, Jiji or Instagram? Our team visits it and checks the host before you send any money.",
      cta: "Check a listing",
      testId: "service-hub-verify",
      photo: "/images/home-hero-768.webp",
    },
  ];

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10 md:py-14">
      <header className="mx-auto mb-10 max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">What we do</p>
        <h1 className="mt-3 text-balance font-serif text-3xl font-medium leading-tight text-foreground sm:text-4xl md:text-5xl">
          Our services
        </h1>
        <p className="mt-4 text-base leading-7 text-muted-foreground sm:text-lg">
          Everything for your Coast trip, on its own or added to your stay: one booking, one total.
        </p>
      </header>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map(({ href, icon: Icon, label, tagline, description, cta, testId, photo }) => (
          <Link
            key={href}
            href={href}
            data-testid={testId}
            className="group flex flex-col overflow-hidden rounded-[1.6rem] border border-border/60 bg-card shadow-[0_18px_40px_-30px_rgba(15,23,42,0.38)] transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_28px_60px_-32px_rgba(15,23,42,0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="relative aspect-[4/3] overflow-hidden bg-muted">
              <ListingMedia
                src={photo}
                alt=""
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              />
              <span className="absolute left-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-primary shadow-sm">
                <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
              </span>
            </div>
            <div className="flex flex-1 flex-col p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{tagline}</p>
              <h2 className="mt-2 font-serif text-2xl font-medium leading-tight text-foreground">{label}</h2>
              <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">{description}</p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                {cta}
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </div>
          </Link>
        ))}
      </div>

      <section className="mx-auto mt-14 max-w-3xl rounded-[1.6rem] border border-border/60 bg-card/80 p-6 text-center shadow-sm sm:p-8">
        <h2 className="font-serif text-2xl font-medium text-foreground sm:text-3xl">Not sure where to start?</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
          Tell us your dates, who's coming and your budget. We'll put the trip together, or find what isn't listed.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="h-12 rounded-full px-6 text-base">
            <Link href="/request-custom-service">Tell us what you need</Link>
          </Button>
          <Button size="lg" variant="outline" className="h-12 rounded-full px-6 text-base" onClick={() => openZaina()}>
            <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
            Ask Zaina
          </Button>
        </div>
      </section>
    </div>
  );
}
