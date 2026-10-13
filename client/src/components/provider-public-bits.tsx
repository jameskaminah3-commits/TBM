// Pieces shared by the public provider page and the "Your host" block: the
// photo or a service icon, the badges, and the rating line. Everything shown
// here comes from the server's allowlisted response.
import { BadgeCheck, Car, ChefHat, Compass, HandHeart, Home, Sparkles, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMonth, providerFoundingMeaning, providerVerifiedMeaning, type PublicProviderSummary } from "@shared/provider-public";
import { formatRating } from "@shared/review-eligibility";

const serviceIcons: Record<string, typeof Home> = {
  Stays: Home,
  "Car hire": Car,
  "Private chef": ChefHat,
  "Home help": HandHeart,
  Experiences: Compass,
};

export function ProviderAvatar({ provider, className }: { provider: Pick<PublicProviderSummary, "photoUrl" | "photoKind" | "displayName" | "serviceTypes">; className?: string }) {
  if (provider.photoUrl) {
    return (
      <img
        src={provider.photoUrl}
        alt={provider.photoKind === "logo" ? `${provider.displayName} logo` : ""}
        className={cn(
          "shrink-0 rounded-3xl border border-border/60 bg-white",
          provider.photoKind === "logo" ? "object-contain p-2" : "object-cover",
          className,
        )}
        data-testid="img-provider-photo"
      />
    );
  }
  const Icon = serviceIcons[provider.serviceTypes[0] ?? ""] ?? Sparkles;
  return (
    <div className={cn("flex shrink-0 items-center justify-center rounded-3xl border border-border/60 bg-[#f1ece2] text-[#1f5d55]", className)} aria-hidden="true" data-testid="icon-provider-service">
      <Icon className="h-1/2 w-1/2" strokeWidth={1.5} />
    </div>
  );
}

export function providerRatingText(rating: PublicProviderSummary["rating"]) {
  return rating ? `${formatRating(rating.average)} · ${rating.count} review${rating.count === 1 ? "" : "s"}` : "New on TBM";
}

export function ProviderRatingLine({ rating, className }: { rating: PublicProviderSummary["rating"]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", className)} data-testid="text-provider-rating">
      {rating ? <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" /> : null}
      <span className={rating ? "font-medium text-foreground" : "text-muted-foreground"}>{providerRatingText(rating)}</span>
    </span>
  );
}

// Badges say what they mean: checked identity and right to offer the service,
// or an early join date. Neither is a promise about quality or safety.
export function ProviderBadges({ provider, showMeaning = false }: { provider: Pick<PublicProviderSummary, "verified" | "foundingProvider" | "memberSince">; showMeaning?: boolean }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {provider.verified ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-800 ring-1 ring-emerald-200" data-testid="badge-provider-verified">
            <BadgeCheck className="h-4 w-4" aria-hidden="true" />
            Verified by TBM
          </span>
        ) : null}
        {provider.foundingProvider ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-900 ring-1 ring-amber-200" title={providerFoundingMeaning} data-testid="badge-provider-founding">
            Founding Provider
          </span>
        ) : null}
        {provider.memberSince ? (
          <span className="text-muted-foreground" data-testid="text-provider-member-since">On TBM since {formatMonth(provider.memberSince)}</span>
        ) : null}
      </div>
      {showMeaning && (provider.verified || provider.foundingProvider) ? (
        <p className="max-w-prose text-xs leading-5 text-muted-foreground">
          {provider.verified ? providerVerifiedMeaning : null}
          {provider.verified && provider.foundingProvider ? " " : null}
          {provider.foundingProvider ? providerFoundingMeaning : null}
        </p>
      ) : null}
    </div>
  );
}
