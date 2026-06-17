import { Link } from "wouter";
import { CarFront, UtensilsCrossed, Sparkles, Compass, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

const SERVICES = [
  {
    href: "/services/drive",
    icon: CarFront,
    label: "Drive",
    tagline: "Airport transfers & car hire",
    description:
      "Trusted self-drive cars and private chauffeurs to help you move around the Coast smoothly.",
    accent: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    testId: "service-hub-drive",
  },
  {
    href: "/services/dine",
    icon: UtensilsCrossed,
    label: "Dine",
    tagline: "Private chefs & catering",
    description:
      "Expert Coast chefs delivering genuine Swahili cuisine and tailored dining experiences to your villa.",
    accent: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    testId: "service-hub-dine",
  },
  {
    href: "/services/relax",
    icon: Sparkles,
    label: "Relax",
    tagline: "Errands, childcare & home support",
    description:
      "From baby care and laundry to shopping and cleaning — the quiet things that let you be fully present on your holiday.",
    accent: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    testId: "service-hub-relax",
  },
  {
    href: "/services/experience",
    icon: Compass,
    label: "Experience",
    tagline: "Curated outings & moments",
    description:
      "Curated local moments — dhow cruises, excursions, and hosted experiences designed around your trip.",
    accent: "bg-primary/10 text-primary",
    testId: "service-hub-experience",
  },
] as const;

export default function ServicesHub() {
  return (
    <div className="container mx-auto px-4 py-10 md:py-14 max-w-2xl">
      <div className="mb-8 text-center">
        <h1 className="font-serif text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          Our Services
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Everything you need to plan, book, and enjoy the Coast — in one place.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {SERVICES.map(({ href, icon: Icon, label, tagline, description, accent, testId }) => (
          <Link
            key={href}
            href={href}
            data-testid={testId}
            className="group flex items-center gap-4 rounded-[1.4rem] border border-border/60 bg-card/80 px-5 py-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-[0_12px_32px_-20px_rgba(15,23,42,0.35)] active:scale-[0.985]"
          >
            <div
              className={cn(
                "flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[1.1rem]",
                accent,
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{label}</span>
                <span className="text-xs text-muted-foreground">{tagline}</span>
              </div>
              <p className="mt-0.5 text-sm leading-5 text-muted-foreground line-clamp-2">
                {description}
              </p>
            </div>

            <ArrowRight
              className="h-4 w-4 flex-shrink-0 text-muted-foreground/50 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground/60"
              strokeWidth={1.75}
            />
          </Link>
        ))}
      </div>
    </div>
  );
}
