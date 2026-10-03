import { Building2, Home, Star, UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";
import { isHotelStay, mealPlans, type MealPlanCode } from "@shared/hotel-rooms";

type StayKindSource = { propertyType?: string | null; starRating?: number | null };

/**
 * "Hotel" or "Entire place", the first thing a guest reads about a stay: a
 * hotel sells rooms on meal plans, an entire place is the whole home.
 */
export function StayKindBadge({
  stay,
  overlay = false,
  className,
}: {
  stay: StayKindSource;
  /** On top of a photo. */
  overlay?: boolean;
  className?: string;
}) {
  const hotel = isHotelStay(stay);
  const Icon = hotel ? Building2 : Home;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none",
        hotel
          ? "border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-100"
          : "border-primary/25 bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-foreground",
        overlay && (hotel ? "bg-amber-50/95 shadow-sm backdrop-blur" : "bg-background/95 shadow-sm backdrop-blur"),
        className,
      )}
      data-testid={hotel ? "badge-hotel" : "badge-entire-place"}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {hotel ? "Hotel" : "Entire place"}
      {hotel && stay.starRating ? (
        <span className="inline-flex items-center gap-0.5" aria-label={`${stay.starRating}-star hotel`}>
          <span aria-hidden="true" className="opacity-60">·</span>
          {stay.starRating}
          <Star className="h-3 w-3 fill-current" aria-hidden="true" />
        </span>
      ) : null}
    </span>
  );
}

/** What each kind of stay means, in one line. */
export function describeStayKind(stay: StayKindSource) {
  return isHotelStay(stay)
    ? "A hotel: book one room or several, on the meal plan you prefer."
    : "An entire place: the whole home is yours, with no shared spaces.";
}

/** The meal plans a hotel offers, as small chips: "BB Bed & breakfast". */
export function MealPlanChips({ plans, className }: { plans: MealPlanCode[]; className?: string }) {
  if (plans.length === 0) {
    return null;
  }
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {plans.map((code) => (
        <span
          key={code}
          className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          title={mealPlans[code].includes}
        >
          <UtensilsCrossed className="h-3 w-3 shrink-0" aria-hidden="true" />
          {mealPlans[code].name}
        </span>
      ))}
    </div>
  );
}
