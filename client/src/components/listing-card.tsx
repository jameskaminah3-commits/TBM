import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Share2, Star } from "lucide-react";
import { PremiumMediaGallery } from "@/components/premium-media-gallery";
import { cn } from "@/lib/utils";

type ListingCardProps = {
  /** The listing's own page; the whole card leads there. */
  href: string;
  title: string;
  media: { id: string; imageUrl?: string | null; galleryUrls?: string[] | null; mediaType?: string | null };
  /** One thing worth knowing at a glance, shown on the photo: "Beachfront", "With a driver". */
  badge?: string | null;
  /** What and where: "Entire place · Diani". */
  subtitle?: ReactNode;
  /** The facts that decide it: "4 bedrooms · up to 8 guests". */
  details?: ReactNode;
  rating: number;
  reviewCount: number;
  /** The price, with its unit. */
  price: ReactNode;
  extra?: ReactNode;
  eagerImage?: boolean;
  className?: string;
  "data-testid"?: string;
};

/**
 * A listing in results: photos that swipe, the title as the link (stretched
 * over the card, so a tap anywhere opens it), a rating in brackets, one badge,
 * and a WhatsApp share for whoever the guest is travelling with.
 */
export function ListingCard({
  href,
  title,
  media,
  badge,
  subtitle,
  details,
  rating,
  reviewCount,
  price,
  extra,
  eagerImage = false,
  className,
  "data-testid": testId,
}: ListingCardProps) {
  const [, setLocation] = useLocation();
  const shareUrl = typeof window === "undefined" ? href : `${window.location.origin}${href}`;
  const shareHref = `https://wa.me/?text=${encodeURIComponent(`${title} on Tembea Bila Matata: ${shareUrl}`)}`;

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[0_14px_36px_-28px_rgba(15,23,42,0.45)] transition-shadow duration-300 hover:shadow-[0_22px_48px_-28px_rgba(15,23,42,0.55)]",
        className,
      )}
      data-testid={testId}
    >
      <div className="relative z-10">
        <PremiumMediaGallery
          item={media}
          title={title}
          aspectClassName="aspect-[4/3]"
          containerClassName="relative overflow-hidden bg-muted"
          imageClassName="transition-transform duration-500 group-hover:scale-[1.03]"
          eagerFirstImage={eagerImage}
          showArrows={false}
          variant="card"
          onOpen={() => setLocation(href)}
          imageSizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        />
        {badge ? (
          <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-slate-900 shadow-sm">
            {badge}
          </span>
        ) : null}
        <a
          href={shareHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Share ${title} on WhatsApp`}
          className="absolute right-2 top-2 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-slate-900 shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid={testId ? `${testId}-share` : undefined}
        >
          <Share2 className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>

      <div className="flex flex-1 flex-col gap-1 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 text-base font-semibold leading-snug text-foreground">
            <Link
              href={href}
              className="after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {title}
            </Link>
          </h3>
          <span className="flex shrink-0 items-center gap-1 pt-0.5 text-sm">
            {reviewCount > 0 ? (
              <>
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
                <span aria-hidden="true" className="font-medium text-foreground">{rating.toFixed(1)}</span>
                <span aria-hidden="true" className="text-muted-foreground">({reviewCount})</span>
                <span className="sr-only">Rated {rating.toFixed(1)} out of 5 from {reviewCount} review{reviewCount === 1 ? "" : "s"}</span>
              </>
            ) : (
              <span className="text-muted-foreground">New</span>
            )}
          </span>
        </div>
        {subtitle ? <p className="line-clamp-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        {details ? <p className="line-clamp-1 text-sm text-muted-foreground">{details}</p> : null}
        {extra}
        <div className="mt-auto pt-2 text-sm text-muted-foreground">{price}</div>
      </div>
    </article>
  );
}

/** The amount in a card's price line: "$320 a night". */
export function ListingPrice({ children }: { children: ReactNode }) {
  return <span className="text-base font-semibold text-foreground">{children}</span>;
}
