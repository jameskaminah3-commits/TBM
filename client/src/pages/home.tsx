import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import {
  Search,
  MapPin,
  Users,
  Home as HomeIcon,
  Car,
  ChefHat,
  ShoppingBag,
  Compass,
  CheckCircle2,
  Star,
  ShieldCheck,
  Handshake,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ListingMedia } from "@/components/listing-media";
import { DateRangePicker } from "@/components/date-range-picker";
import { buildStaySearchParams } from "@/lib/stay-search";
// The hero lives in /images under fixed names, so the server can tell the
// browser to fetch it first on the home page (see server/share-metadata.ts).
const heroImageLarge = "/images/home-hero-1408.webp";
const heroImageSmall = "/images/home-hero-768.webp";
import messyWhatsappImage from "@assets/generated_images/home-whatsapp-420.jpg";
import type { Stay, Car as CarType, Cook, Errand, Experience } from "@shared/schema";
import { todayInKenya } from "@shared/calendar-dates";
import { brandStory } from "@/lib/brand-story";
import { openZaina, whatsAppUrlWithText } from "@/lib/zaina";

type ShowcaseItem = {
  id: string;
  title: string;
  imageUrl?: string | null;
  mediaType?: string | null;
  rating: number;
  reviewCount: number;
};

// One icon per promise, in the order brandStory lists them: we check places,
// we meet guests when they arrive, we fix what isn't right.
const promiseIcons = [ShieldCheck, Handshake, Wrench];

function ServiceShowcaseCard({
  icon,
  title,
  description,
  items,
  seeAllLabel,
}: {
  icon: any;
  title: string;
  description: string;
  items: ShowcaseItem[];
  seeAllLabel: string;
}) {
  const Icon = icon;
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const safeItems = items.length
    ? items
    : [
        {
          id: `${title}-fallback`,
          title,
          imageUrl: null,
          mediaType: "image",
          rating: 5,
          reviewCount: 0,
        },
      ];

  useEffect(() => {
    setActiveIndex(0);
  }, [safeItems.length]);

  useEffect(() => {
    if (isPaused || safeItems.length <= 1) {
      return;
    }

    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % safeItems.length);
    }, 4500);

    return () => window.clearInterval(interval);
  }, [isPaused, safeItems.length]);

  return (
    <Card
      className="group h-full cursor-pointer overflow-hidden rounded-[1.75rem] border border-border/60 bg-card shadow-[0_18px_40px_-30px_rgba(15,23,42,0.38)] transition-[transform,box-shadow] duration-300 hover:-translate-y-2 hover:shadow-[0_28px_60px_-32px_rgba(15,23,42,0.5)]"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={() => setIsPaused(true)}
      onTouchEnd={() => window.setTimeout(() => setIsPaused(false), 1800)}
    >
      <div className="p-6 pb-4">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 transition-colors group-hover:bg-primary/15">
          <Icon className="h-8 w-8 text-primary" strokeWidth={1.8} />
        </div>
        <h3 className="mb-3 font-serif text-2xl font-medium leading-tight text-foreground">{title}</h3>
        <p className="min-h-[5.5rem] text-sm leading-7 text-muted-foreground">{description}</p>
      </div>

      <div className="px-4 pb-4">
        <div className="relative overflow-hidden rounded-[1.3rem] bg-muted">
          <div className="relative aspect-[4/3]">
            {safeItems.map((item, index) => (
              <div
                key={item.id}
                className={`absolute inset-0 transition-[opacity,transform] duration-700 ${index === activeIndex ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-[1.03]"}`}
              >
                {item.imageUrl ? (
                  <ListingMedia
                    src={item.imageUrl}
                    alt={item.title}
                    mediaType={item.mediaType}
                    className="h-full w-full object-cover"
                    loading={index === 0 ? "eager" : "lazy"}
                    decoding="async"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-primary/10">
                    <Icon className="h-10 w-10 text-primary/70" strokeWidth={1.7} />
                  </div>
                )}

                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(14,23,35,0.06)_0%,rgba(14,23,35,0.12)_38%,rgba(14,23,35,0.74)_100%)]" />
                <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Star className="h-4 w-4 fill-[#f4c95d] text-[#f4c95d]" />
                    <span>{item.rating.toFixed(1)}</span>
                    <span className="text-white/70">{item.reviewCount} reviews</span>
                  </div>
                  <div className="line-clamp-1 font-serif text-lg leading-tight">{item.title}</div>
                </div>
              </div>
            ))}
          </div>

          {safeItems.length > 1 ? (
            <div className="absolute left-4 top-4 flex items-center gap-1.5">
              {safeItems.slice(0, 6).map((item, index) => (
                <span
                  key={`${item.id}-dot`}
                  className={`h-1.5 rounded-full transition-all duration-300 ${index === activeIndex ? "w-5 bg-white" : "w-1.5 bg-white/45"}`}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="px-6 pb-6 pt-1">
        <div className="text-sm font-medium text-primary">{seeAllLabel} -&gt;</div>
      </div>
    </Card>
  );
}

export default function Home() {
  const [, setLocation] = useLocation();
  const [destination, setDestination] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guests, setGuests] = useState("2");
  const [shouldLoadShowcases, setShouldLoadShowcases] = useState(false);
  const servicesSectionRef = useRef<HTMLElement | null>(null);
  const heroServiceLabels = ["Stays", "Transport", "Private Chefs", "Experience", "Errands"];
  const heroImageSrcSet = `${heroImageSmall} 768w, ${heroImageLarge} 1408w`;
  const primaryCtaClassName =
    "w-full rounded-xl border border-white/12 bg-[#f98b5b] px-6 py-5 text-base font-semibold text-[#1f2a2e] shadow-[0_20px_44px_-24px_rgba(249,139,91,0.58),inset_0_1px_0_rgba(255,255,255,0.18)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#f58756] hover:shadow-[0_24px_54px_-24px_rgba(249,139,91,0.66)] sm:w-auto sm:min-w-[16rem] sm:px-8 sm:py-6 sm:text-lg";
  // Stays are on the coast: the earliest check-in is Kenya's today, wherever the guest is.
  const todayIso = useMemo(() => todayInKenya(), []);

  useEffect(() => {
    if (shouldLoadShowcases) {
      return;
    }

    const preloadTimer = window.setTimeout(() => setShouldLoadShowcases(true), 700);
    return () => window.clearTimeout(preloadTimer);
  }, [shouldLoadShowcases]);

  useEffect(() => {
    if (shouldLoadShowcases) {
      return;
    }

    const section = servicesSectionRef.current;
    if (!section || typeof IntersectionObserver === "undefined") {
      const fallbackTimer = window.setTimeout(() => setShouldLoadShowcases(true), 1200);
      return () => window.clearTimeout(fallbackTimer);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoadShowcases(true);
          observer.disconnect();
        }
      },
      { rootMargin: "320px 0px" },
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, [shouldLoadShowcases]);

  const handleAccommodationSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const parsedGuests = Number.parseInt(guests, 10);
    const safeGuests = Number.isNaN(parsedGuests) || parsedGuests < 1 ? null : parsedGuests;
    const safeCheckOut = checkIn && checkOut && checkOut < checkIn ? checkIn : checkOut;
    const nextSearch = buildStaySearchParams({
      destination,
      checkIn,
      checkOut: safeCheckOut,
      guests: safeGuests,
    });

    setLocation(nextSearch ? `/accommodations?${nextSearch}` : "/accommodations");
  };

  const { data: stays = [] } = useQuery<Stay[]>({
    queryKey: ["/api/stays"],
    enabled: shouldLoadShowcases,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: cars = [] } = useQuery<CarType[]>({
    queryKey: ["/api/cars"],
    enabled: shouldLoadShowcases,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: cooks = [] } = useQuery<Cook[]>({
    queryKey: ["/api/cooks"],
    enabled: shouldLoadShowcases,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: errands = [] } = useQuery<Errand[]>({
    queryKey: ["/api/errands"],
    enabled: shouldLoadShowcases,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: experiences = [] } = useQuery<Experience[]>({
    queryKey: ["/api/experiences"],
    enabled: shouldLoadShowcases,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const serviceShowcases = useMemo(() => {
    const stayItems: ShowcaseItem[] = stays.slice(0, 6).map((stay) => ({
      id: stay.id,
      title: stay.title,
      imageUrl: stay.imageUrl || stay.galleryUrls?.[0] || null,
      mediaType: stay.mediaType,
      rating: stay.rating,
      reviewCount: stay.reviewCount,
    }));

    const carItems: ShowcaseItem[] = cars.slice(0, 6).map((car) => ({
      id: car.id,
      title: car.model,
      imageUrl: car.imageUrl || car.galleryUrls?.[0] || null,
      mediaType: car.mediaType,
      rating: car.rating,
      reviewCount: car.reviewCount,
    }));

    const cookItems: ShowcaseItem[] = cooks.slice(0, 6).map((cook) => ({
      id: cook.id,
      title: cook.title,
      imageUrl: cook.imageUrl || cook.galleryUrls?.[0] || null,
      mediaType: cook.mediaType,
      rating: cook.rating,
      reviewCount: cook.reviewCount,
    }));

    const errandItems: ShowcaseItem[] = errands.slice(0, 6).map((errand) => ({
      id: errand.id,
      title: errand.serviceName,
      imageUrl: errand.imageUrl || errand.galleryUrls?.[0] || null,
      mediaType: errand.mediaType,
      rating: errand.rating,
      reviewCount: errand.reviewCount,
    }));

    const experienceItems: ShowcaseItem[] = experiences.slice(0, 6).map((experience) => ({
      id: experience.id,
      title: experience.title,
      imageUrl: experience.imageUrl || experience.galleryUrls?.[0] || null,
      mediaType: experience.mediaType,
      rating: experience.rating,
      reviewCount: experience.reviewCount,
    }));

    return { stayItems, carItems, cookItems, errandItems, experienceItems };
  }, [stays, cars, cooks, errands, experiences]);

  return (
    <div className="min-h-screen">
      <section className="relative flex min-h-[100svh] items-center overflow-hidden py-10 sm:py-14 md:min-h-screen md:justify-center">
        <img
          src={heroImageLarge}
          srcSet={heroImageSrcSet}
          sizes="100vw"
          alt=""
          aria-hidden="true"
          width={1408}
          height={768}
          className="absolute inset-0 h-full w-full object-cover"
          loading="eager"
          decoding="async"
          // React 18 passes the attribute through only in lowercase.
          {...{ fetchpriority: "high" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/52 via-black/40 to-black/58" />

        <div className="relative z-10 container mx-auto px-4 text-center md:px-8">
          <p className="mb-3 text-[0.78rem] font-semibold uppercase tracking-[0.26em] text-white/85 [text-shadow:0_2px_10px_rgba(0,0,0,0.42)] sm:mb-4 sm:text-sm">
            Tembea Bila Matata
          </p>
          <h1 className="mb-4 text-balance font-serif text-[2.6rem] font-medium leading-[1.02] text-white sm:mb-6 sm:text-6xl lg:text-7xl">
            {brandStory.headline}
          </h1>
          <p className="mx-auto mb-6 max-w-3xl text-balance text-base leading-7 text-white/90 sm:mb-10 sm:text-lg md:text-xl">
            {brandStory.hook}
          </p>

          <div className="mx-auto mb-6 flex max-w-4xl flex-wrap items-center justify-center gap-x-3 gap-y-2 px-3 text-[0.74rem] font-medium tracking-[0.12em] text-[rgba(246,240,232,0.86)] [text-shadow:0_2px_10px_rgba(0,0,0,0.42)] sm:mb-8 sm:gap-x-4 sm:px-0 sm:text-[0.86rem]">
            {heroServiceLabels.map((label, index) => (
              <div key={label} className="flex items-center gap-3">
                {index > 0 ? (
                  <span className="h-1 w-1 rounded-full bg-[#f98b5b] shadow-[0_0_0_3px_rgba(249,139,91,0.14)]" aria-hidden="true" />
                ) : null}
                <span>{label}</span>
              </div>
            ))}
          </div>

          <div className="mb-6 flex flex-col items-center justify-center gap-3 sm:mb-8 sm:flex-row">
            <Button
              size="lg"
              className={primaryCtaClassName}
              onClick={() => openZaina()}
              data-testid="button-hero-tell-us"
            >
              Tell us what you need
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="w-full rounded-xl border border-white/55 bg-white/8 px-6 py-5 text-base text-white shadow-lg backdrop-blur-sm hover:border-white/75 hover:bg-white/14 sm:w-auto sm:min-w-[16rem] sm:px-8 sm:py-6 sm:text-lg"
              onClick={() => setLocation("/verify")}
              data-testid="button-hero-verify"
            >
              Check a listing before you pay
            </Button>
          </div>

          <form onSubmit={handleAccommodationSearch}>
            <Card className="mx-auto max-w-4xl rounded-2xl border-none bg-card/95 p-4 shadow-2xl backdrop-blur-md sm:p-5 md:p-8 lg:order-last">
              <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="md:col-span-1">
                  <div className="mb-2 text-sm font-medium text-muted-foreground">Destination</div>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={destination}
                      onChange={(event) => setDestination(event.target.value)}
                      placeholder="Where to?"
                      className="rounded-lg pl-10"
                      data-testid="input-destination"
                      aria-label="Destination"
                    />
                  </div>
                </div>

                <div className="md:col-span-2">
                  <div className="mb-2 text-sm font-medium text-muted-foreground" id="home-dates-label">Dates</div>
                  <DateRangePicker
                    checkIn={checkIn}
                    checkOut={checkOut}
                    minDate={todayIso}
                    onChange={(next) => {
                      setCheckIn(next.checkIn);
                      setCheckOut(next.checkOut);
                    }}
                    placeholder="Check in – check out"
                    data-testid="input-dates"
                  />
                </div>

                <div>
                  <div className="mb-2 text-sm font-medium text-muted-foreground">Guests</div>
                  <div className="relative">
                    <Users className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="number"
                      value={guests}
                      onChange={(event) => setGuests(event.target.value)}
                      placeholder="2"
                      min="1"
                      className="rounded-lg pl-10"
                      data-testid="input-guests"
                      aria-label="Guests"
                    />
                  </div>
                </div>
              </div>

              <Button className="w-full rounded-lg" size="lg" type="submit" data-testid="button-search">
                <Search className="mr-2 h-5 w-5" />
                Search Accommodations
              </Button>
            </Card>
          </form>
        </div>
      </section>

      {/* The story, in the owner's words: the usual way, then what TBM does. */}
      <section className="bg-background py-16 md:py-24" aria-labelledby="home-story-heading">
        <div className="container mx-auto grid max-w-6xl gap-10 px-4 md:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-16">
          <div className="min-w-0">
            <p className="max-w-xl text-lg leading-8 text-foreground/80 sm:text-xl sm:leading-9">{brandStory.problem}</p>
            <div className="mt-8 max-w-[17rem] overflow-hidden rounded-[1.5rem] border border-border/60 bg-muted shadow-[0_20px_45px_-36px_rgba(15,23,42,0.35)] sm:max-w-sm">
              <img
                src={messyWhatsappImage}
                alt="WhatsApp chats with a driver, a chef and an errands service, each going back and forth over times and prices"
                width={420}
                height={568}
                className="block h-auto w-full"
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>

          <div className="min-w-0">
            <h2 id="home-story-heading" className="text-balance font-serif text-[2.2rem] font-medium leading-tight text-foreground sm:text-5xl">
              {brandStory.answerLead}
            </h2>
            <p className="mt-4 max-w-xl text-lg leading-8 text-muted-foreground sm:text-xl">{brandStory.answer}</p>
            <ul className="mt-8 grid gap-3" data-testid="list-home-examples">
              {brandStory.examples.map((example) => (
                <li key={example} className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3 text-base leading-7 text-foreground/90 shadow-sm">
                  <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-primary" />
                  {example}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Three ways in: browse and book, tell us, or send a listing first. */}
      <section className="border-y border-border/60 bg-muted/30 py-14 md:py-20" aria-labelledby="home-paths-heading">
        <div className="container mx-auto max-w-6xl px-4 md:px-8">
          <h2 id="home-paths-heading" className="sr-only">Three ways to start</h2>
          <div className="grid gap-4 md:grid-cols-3 md:gap-6">
            <div className="flex flex-col rounded-[1.5rem] border border-border/60 bg-card p-6 shadow-sm">
              <h3 className="text-sm font-medium text-muted-foreground">{brandStory.paths.browse.question}</h3>
              <p className="mt-2 font-serif text-3xl font-medium leading-tight text-foreground">{brandStory.paths.browse.answer}</p>
              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-6">
                <Button asChild className="rounded-full px-5">
                  <Link href="/accommodations" data-testid="link-home-path-browse">Browse stays</Link>
                </Button>
                <Link href="/services" className="text-sm font-medium text-primary hover:underline">See all services</Link>
              </div>
            </div>

            <div className="flex flex-col rounded-[1.5rem] border border-border/60 bg-card p-6 shadow-sm">
              <h3 className="text-sm font-medium text-muted-foreground">{brandStory.paths.tellUs.question}</h3>
              <p className="mt-2 font-serif text-3xl font-medium leading-tight text-foreground">{brandStory.paths.tellUs.answer}</p>
              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-6">
                <Button className="rounded-full px-5" onClick={() => openZaina()} data-testid="button-home-path-tell-us">
                  Tell us what you need
                </Button>
                <Link href="/request-custom-service" className="text-sm font-medium text-primary hover:underline">Or send a request</Link>
              </div>
            </div>

            <div className="flex flex-col rounded-[1.5rem] border border-border/60 bg-card p-6 shadow-sm">
              <h3 className="text-sm font-medium text-muted-foreground">{brandStory.paths.sendFirst.question}</h3>
              <p className="mt-2 font-serif text-3xl font-medium leading-tight text-foreground">{brandStory.paths.sendFirst.answer}</p>
              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-6">
                <Button asChild className="rounded-full px-5">
                  <Link href="/verify" data-testid="link-home-path-verify">Check a listing</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="services-section" ref={servicesSectionRef} className="bg-background py-20 md:py-24">
        <div className="container mx-auto px-4 md:px-8">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-serif text-[2rem] font-medium leading-tight sm:text-4xl lg:text-5xl">Our Services</h2>
            <p className="mx-auto max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              Everything you need to plan, book, and enjoy the Coast with less effort and better local access
            </p>
          </div>

          <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 md:grid-cols-2 md:gap-8 lg:grid-cols-3 xl:grid-cols-5">
            <Link href="/accommodations" data-testid="service-card-stay">
              <ServiceShowcaseCard
                icon={HomeIcon}
                title="Stays"
                description="Hand-picked villas and apartments chosen for comfort, location, and authentic coastal charm."
                items={serviceShowcases.stayItems}
                seeAllLabel="See all stays"
              />
            </Link>

            <Link href="/services/drive" data-testid="service-card-drive">
              <ServiceShowcaseCard
                icon={Car}
                title="Drive"
                description="Trusted self-drive cars and private chauffeurs to help you move around the Coast smoothly."
                items={serviceShowcases.carItems}
                seeAllLabel="See all drive options"
              />
            </Link>

            <Link href="/services/dine" data-testid="service-card-dine">
              <ServiceShowcaseCard
                icon={ChefHat}
                title="Dine"
                description="Expert Coast chefs delivering genuine Swahili cuisine and tailored dining experiences to your villa."
                items={serviceShowcases.cookItems}
                seeAllLabel="See all dining"
              />
            </Link>

            <Link href="/services/relax" data-testid="service-card-relax">
              <ServiceShowcaseCard
                icon={ShoppingBag}
                title="Relax"
                description="Shopping, laundry, cleaning, and daily tasks handled discreetly so you can fully enjoy your stay."
                items={serviceShowcases.errandItems}
                seeAllLabel="See all relax services"
              />
            </Link>

            <Link href="/services/experience" data-testid="service-card-experience">
              <ServiceShowcaseCard
                icon={Compass}
                title="Experience"
                description="Curated local moments - dhow cruises, excursions, and hosted experiences designed around your trip."
                items={serviceShowcases.experienceItems}
                seeAllLabel="See all experiences"
              />
            </Link>
          </div>
        </div>
      </section>

      {/* What guests can count on, and the closing line, in the owner's words. */}
      <section className="bg-[linear-gradient(180deg,rgba(249,245,239,0.95)_0%,rgba(246,240,231,0.95)_100%)] py-16 dark:bg-none dark:bg-muted/20 md:py-24" aria-labelledby="home-promises-heading">
        <div className="container mx-auto max-w-6xl px-4 md:px-8">
          <h2 id="home-promises-heading" className="text-center font-serif text-[2rem] font-medium leading-tight sm:text-4xl lg:text-5xl">
            Why Tembea Bila Matata
          </h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-3 md:gap-6" data-testid="list-home-promises">
            {brandStory.promises.map((promise, index) => {
              const Icon = promiseIcons[index] ?? CheckCircle2;
              return (
                <li key={promise} className="rounded-[1.5rem] border border-black/5 bg-white/85 p-6 shadow-[0_20px_45px_-36px_rgba(15,23,42,0.2)] dark:border-border/40 dark:bg-card/80">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <p className="mt-4 text-balance font-serif text-2xl font-medium leading-snug text-foreground">{promise}</p>
                </li>
              );
            })}
          </ol>

          <div className="mx-auto mt-16 max-w-3xl text-center">
            <p className="text-balance font-serif text-[1.9rem] font-medium leading-tight text-foreground sm:text-4xl">{brandStory.closing[0]}</p>
            <p className="mt-3 text-balance font-serif text-[1.9rem] font-medium leading-tight text-primary sm:text-4xl">{brandStory.closing[1]}</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className={primaryCtaClassName} onClick={() => openZaina()} data-testid="button-cta">
                {brandStory.callToAction}
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full rounded-xl px-6 py-5 text-base sm:w-auto sm:px-8 sm:py-6 sm:text-lg">
                <a
                  href={whatsAppUrlWithText("Hi Tembea Bila Matata, here's what I need for my Coast trip: ")}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="link-home-whatsapp"
                >
                  Or message us on WhatsApp
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
