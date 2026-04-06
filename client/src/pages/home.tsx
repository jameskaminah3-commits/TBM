import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import {
  Search,
  MapPin,
  Calendar,
  Users,
  Home as HomeIcon,
  Car,
  ChefHat,
  ShoppingBag,
  Compass,
  CheckCircle2,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ListingMedia } from "@/components/listing-media";
import { buildStaySearchParams } from "@/lib/stay-search";
import heroImageLarge from "@assets/generated_images/home-hero-1408.jpg";
import heroImageSmall from "@assets/generated_images/home-hero-768.jpg";
import chefStoryImage from "@assets/generated_images/home-chef-960.jpg";
import messyWhatsappImage from "@assets/generated_images/home-whatsapp-420.jpg";
import type { Stay, Car as CarType, Cook, Errand, Experience } from "@shared/schema";

type ShowcaseItem = {
  id: string;
  title: string;
  imageUrl?: string | null;
  mediaType?: string | null;
  rating: number;
  reviewCount: number;
};

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
      className="group h-full cursor-pointer overflow-hidden rounded-[1.75rem] border border-black/5 bg-white/95 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.38)] transition-all duration-300 hover:-translate-y-2 hover:shadow-[0_28px_60px_-32px_rgba(15,23,42,0.5)]"
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
                className={`absolute inset-0 transition-all duration-700 ${index === activeIndex ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-[1.03]"}`}
              >
                {item.imageUrl ? (
                  <ListingMedia
                    src={item.imageUrl}
                    alt={item.title}
                    mediaType={item.mediaType}
                    className="h-full w-full object-cover"
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
  const heroServiceLabels = ["Stays", "Transport", "Private Chefs", "Experience", "Errands"];
  const heroImageSrcSet = `${heroImageSmall} 768w, ${heroImageLarge} 1408w`;
  const primaryCtaClassName =
    "w-full rounded-xl border border-white/12 bg-[#f98b5b] px-6 py-5 text-base font-medium text-white shadow-[0_20px_44px_-24px_rgba(249,139,91,0.58),inset_0_1px_0_rgba(255,255,255,0.18)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#f58756] hover:shadow-[0_24px_54px_-24px_rgba(249,139,91,0.66)] sm:w-auto sm:min-w-[16rem] sm:px-8 sm:py-6 sm:text-lg";
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const whyTembeaStories = [
    {
      eyebrow: "Trust You Can Rely On",
      title: "Every detail is verified before it reaches your holiday.",
      description:
        "Every villa is personally inspected, every chef and driver is thoroughly vetted, and every experience is hand-picked. We only partner with people we would confidently recommend to our own families.",
      image: "/uploads/1774855399992-0122d6b5c072.jpg",
      position: "center",
      visual: "photo",
    },
    {
      eyebrow: "Real Coast Expertise",
      title: "Local knowledge that feels genuine, not packaged.",
      description:
        "Our chefs, drivers, and guides are locals who know the best markets, family recipes, hidden sunset spots, and genuine Swahili traditions - delivering experiences that feel authentic, not touristy.",
      image: chefStoryImage,
      position: "center",
      visual: "photo",
    },
    {
      eyebrow: "One App, Complete Peace Of Mind",
      title: "Everything beautifully coordinated in one calm place.",
      description:
        "No more juggling multiple WhatsApp chats or vendors. From your stay to private chef, airport transfer, grocery shopping, laundry, and special experiences - everything is coordinated in one place.",
      visual: "app",
    },
    {
      eyebrow: "Smart Bundles That Actually Save You Time",
      title: "Thoughtful combinations, less planning stress.",
      description:
        "We design thoughtful combinations like stay, chef, and welcome shopping so you get better value and a smoother trip without having to piece everything together yourself.",
      visual: "bundle",
    },
    {
      eyebrow: "Designed Around Your Kind Of Trip",
      title: "Tailored for romance, family ease, or something worth celebrating.",
      description:
        "Whether you're a couple seeking romance, a family wanting convenience, or a group celebrating something special, we shape the details so your holiday feels personal and memorable.",
      image: "/uploads/1774448207111-27ddce48058c.jpg",
      position: "center top",
      visual: "photo",
    },
  ] as const;

  const scrollToServices = () => {
    const servicesSection = document.getElementById("services-section");
    if (servicesSection) {
      servicesSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

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
  });

  const { data: cars = [] } = useQuery<CarType[]>({
    queryKey: ["/api/cars"],
  });

  const { data: cooks = [] } = useQuery<Cook[]>({
    queryKey: ["/api/cooks"],
  });

  const { data: errands = [] } = useQuery<Errand[]>({
    queryKey: ["/api/errands"],
  });

  const { data: experiences = [] } = useQuery<Experience[]>({
    queryKey: ["/api/experiences"],
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
          fetchPriority="high"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/60 to-black/75" />

        <div className="relative z-10 container mx-auto px-4 text-center md:px-8">
          <h1 className="mb-4 text-balance font-serif text-[2.35rem] font-medium leading-[1.02] text-white sm:mb-6 sm:text-5xl lg:text-7xl">
            Tembea Bila Matata
          </h1>
          <p className="mx-auto mb-6 max-w-4xl text-balance text-base leading-7 text-white/90 sm:mb-10 sm:text-lg md:text-xl">
            Plan your Coast, without the chaos
          </p>

          <form className="mb-6 lg:mb-0" onSubmit={handleAccommodationSearch}>
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
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-sm font-medium text-muted-foreground">Check in</div>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="date"
                      value={checkIn}
                      min={todayIso}
                      onChange={(event) => {
                        const nextCheckIn = event.target.value;
                        setCheckIn(nextCheckIn);
                        if (checkOut && nextCheckIn && checkOut < nextCheckIn) {
                          setCheckOut(nextCheckIn);
                        }
                      }}
                      className="rounded-lg pl-10"
                      data-testid="input-checkin"
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-sm font-medium text-muted-foreground">Check out</div>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="date"
                      value={checkOut}
                      min={checkIn || todayIso}
                      onChange={(event) => setCheckOut(event.target.value)}
                      className="rounded-lg pl-10"
                      data-testid="input-checkout"
                    />
                  </div>
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

          <div className="mb-6 flex flex-col items-center justify-center gap-3 sm:flex-row lg:mb-16">
            <Button
              size="lg"
              className={primaryCtaClassName}
              onClick={scrollToServices}
              data-testid="button-explore-services"
            >
              Browse All Services
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="w-full rounded-xl border border-white/55 bg-white/8 px-6 py-5 text-base text-white shadow-lg backdrop-blur-sm hover:border-white/75 hover:bg-white/14 sm:w-auto sm:min-w-[16rem] sm:px-8 sm:py-6 sm:text-lg"
              onClick={() => setLocation("/request-custom-service")}
              data-testid="button-hero-custom-service"
            >
              Request a Custom Service
            </Button>
          </div>

          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-3 gap-y-2 px-3 text-[0.74rem] font-medium tracking-[0.12em] text-[rgba(246,240,232,0.86)] [text-shadow:0_2px_10px_rgba(0,0,0,0.42)] sm:gap-x-4 sm:px-0 sm:text-[0.86rem] lg:mb-8">
            {heroServiceLabels.map((label, index) => (
              <div key={label} className="flex items-center gap-3">
                {index > 0 ? (
                  <span className="h-1 w-1 rounded-full bg-[#f98b5b] shadow-[0_0_0_3px_rgba(249,139,91,0.14)]" aria-hidden="true" />
                ) : null}
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="services-section" className="bg-background py-20 md:py-24">
        <div className="container mx-auto px-4 md:px-8">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-serif text-[2rem] font-medium leading-tight sm:text-4xl lg:text-5xl">Our Services</h2>
            <p className="mx-auto max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              Everything you need to plan, book, and enjoy the Coast with less effort and better local access
            </p>
          </div>

          <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 md:grid-cols-2 md:gap-8 xl:grid-cols-5">
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

      <section className="bg-[linear-gradient(180deg,rgba(249,245,239,0.95)_0%,rgba(246,240,231,0.95)_100%)] py-20 md:py-24">
        <div className="container mx-auto px-4 md:px-8">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-serif text-[2rem] font-medium leading-tight sm:text-4xl lg:text-5xl">
              Why Tembea Bila Matata
            </h2>
            <p className="mx-auto max-w-4xl text-base leading-7 text-muted-foreground sm:text-lg">
              We go beyond listing services - we carefully select, verify, and coordinate everything so your Kenyan Coast trip feels effortless, authentic, and truly worry-free.
            </p>
          </div>

          <div className="mx-auto flex max-w-6xl flex-col gap-6">
            {whyTembeaStories.map((story, index) => (
              <article
                key={story.title}
                className="group"
              >
                <div className="grid items-center gap-5 overflow-hidden rounded-[2rem] border border-black/5 bg-white/85 p-4 shadow-[0_20px_45px_-36px_rgba(15,23,42,0.2)] backdrop-blur-sm transition-all duration-500 ease-out group-hover:-translate-y-2 group-hover:shadow-[0_28px_58px_-36px_rgba(15,23,42,0.28)] md:p-5 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)] lg:gap-8">
                  <div className={index % 2 === 1 ? "lg:order-2" : ""}>
                    <div className="relative overflow-hidden rounded-[1.5rem] bg-muted">
                      {story.visual === "photo" ? (
                        <div className="relative aspect-[4/3] md:aspect-[16/10]">
                          <img
                            src={story.image}
                            alt={story.title}
                            className="absolute inset-0 h-full w-full scale-100 object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                            style={{ objectPosition: story.position }}
                            loading="lazy"
                            decoding="async"
                          />
                          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(87,56,31,0.06)_0%,rgba(87,56,31,0.14)_36%,rgba(26,18,12,0.36)_100%)]" />
                          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,219,170,0.14),transparent_42%,rgba(10,123,135,0.08)_100%)]" />
                          <div className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/60 bg-[#e0f6f4]/88 shadow-sm backdrop-blur-sm">
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                          </div>
                        </div>
                      ) : story.visual === "app" ? (
                        <div className="relative aspect-[4/3] overflow-hidden bg-[linear-gradient(145deg,#f7efe4_0%,#f2e4d2_42%,#e6f5f2_100%)] p-6 md:aspect-[16/10]">
                          <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.7),transparent_70%)]" />
                          <div className="mx-auto flex h-full max-w-[18rem] items-center justify-center">
                            <div className="relative w-full rounded-[2rem] border border-black/8 bg-[#fffdf8] p-3 shadow-[0_30px_60px_-32px_rgba(15,23,42,0.35)]">
                              <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-stone-200" />
                              <div className="rounded-[1.4rem] bg-[linear-gradient(135deg,#0b7b87,#13a3a5)] p-4 text-white">
                                <div className="text-xs uppercase tracking-[0.24em] text-white/75">Tembea Dashboard</div>
                                <div className="mt-2 font-serif text-2xl">
                                  Your Coast plan
                                </div>
                              </div>
                              <div className="mt-3 space-y-2">
                                {[
                                  "Beach villa in Watamu",
                                  "Private chef arrival dinner",
                                  "Airport pickup confirmed",
                                  "Welcome shopping handled",
                                ].map((line) => (
                                  <div key={line} className="flex items-center justify-between rounded-2xl bg-stone-50 px-3 py-2.5">
                                    <span className="text-sm text-stone-700">{line}</span>
                                    <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">Ready</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="relative overflow-hidden bg-[linear-gradient(145deg,#f7efe4_0%,#f4eadf_40%,#eff7f6_100%)] p-5 min-h-[36rem] md:aspect-[16/10] md:min-h-0">
                          <div className="grid gap-4 md:h-full md:grid-cols-2">
                            <div className="relative overflow-hidden rounded-[1.5rem] border border-[#d8c4b3] bg-[linear-gradient(145deg,#efe3d6_0%,#e5d6c6_100%)] p-4 shadow-[0_14px_32px_-24px_rgba(15,23,42,0.22)]">
                              <div className="relative mb-3 text-xs uppercase tracking-[0.24em] text-stone-500">Older way</div>
                              <div className="relative overflow-hidden rounded-[1.2rem] bg-[#d9cabd]">
                                <img
                                  src={messyWhatsappImage}
                                  alt="Multiple WhatsApp chats coordinating travel services"
                                  width={420}
                                  height={568}
                                  className="w-full object-contain"
                                  style={{ aspectRatio: "728 / 1192" }}
                                  loading="lazy"
                                  decoding="async"
                                />
                              </div>
                            </div>
                            <div className="rounded-[1.5rem] border border-primary/10 bg-white p-4 shadow-[0_14px_32px_-24px_rgba(15,23,42,0.22)]">
                              <div className="mb-3 text-xs uppercase tracking-[0.24em] text-primary/70">Bila Matata Bundle</div>
                              <div className="rounded-[1.2rem] bg-[linear-gradient(135deg,#0b7b87,#1ba8a3)] p-4 text-white">
                                <div className="font-serif text-xl">
                                  Stay + Chef + Welcome shopping
                                </div>
                                <div className="mt-2 text-sm text-white/80">One itinerary. One confirmation. One calm arrival.</div>
                              </div>
                              <div className="mt-3 space-y-2 text-sm text-stone-700">
                                <div className="flex items-center justify-between rounded-2xl bg-stone-50 px-3 py-2.5">
                                  <span>Bundle savings</span>
                                  <span className="font-semibold text-primary">12% off</span>
                                </div>
                                <div className="flex items-center justify-between rounded-2xl bg-stone-50 px-3 py-2.5">
                                  <span>Arrival support</span>
                                  <span className="font-semibold text-stone-900">Included</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className={`px-2 py-2 md:px-3 ${index % 2 === 1 ? "lg:order-1" : ""}`}>
                    <div className="mb-4 flex items-center gap-3 text-primary">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                        <CheckCircle2 className="h-4.5 w-4.5" />
                      </div>
                      <span className="text-xs font-semibold uppercase tracking-[0.28em] text-primary/80">{story.eyebrow}</span>
                    </div>
                    <h3
                      className="mb-4 max-w-xl text-balance font-serif text-3xl font-medium leading-tight text-foreground md:text-[2.3rem]"
                    >
                      {story.title}
                    </h3>
                    <p className="max-w-xl text-base leading-8 text-muted-foreground">{story.description}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-background py-20 md:py-24">
        <div className="container mx-auto px-4 text-center md:px-8">
          <h2 className="mb-6 font-serif text-[2rem] font-medium leading-tight sm:text-4xl lg:text-5xl">
            Ready for Your Coastal Escape?
          </h2>
          <p className="mx-auto mb-8 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            Book your perfect stay with all the services you need
          </p>
          <Button
            size="lg"
            className={primaryCtaClassName}
            onClick={() => setLocation("/accommodations")}
            data-testid="button-cta"
          >
            Explore Accommodations
          </Button>
        </div>
      </section>
    </div>
  );
}
