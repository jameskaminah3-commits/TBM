import type { ReactNode } from "react";
import { Baby, CalendarClock, ExternalLink, Home, MapPin } from "lucide-react";
import { isHotelStay, type HotelPolicy, type RoomRate } from "@shared/hotel-rooms";
import { getAreaMapsLink } from "@shared/stay-location";
import { describeStayRules, type StayRules } from "@shared/stay-rules";

type StayForGuests = {
  title: string;
  location: string;
  propertyType?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  hotelPolicy?: HotelPolicy | null;
  rules?: StayRules | null;
  /** The exact pin, when the stay shows it to everyone. */
  mapUrl?: string | null;
  roomTypes?: Array<{ rates: RoomRate[] }> | null;
};

/**
 * Where a stay is: its area, and a button that opens Google Maps. A hotel
 * (or a home whose owner chose to) opens on the exact pin; otherwise the
 * button shows the area, and the exact pin comes with the booking.
 */
export function StayLocationSection({ stay }: { stay: StayForGuests }) {
  const exact = Boolean(stay.mapUrl);
  const href = stay.mapUrl || getAreaMapsLink(stay.location);
  return (
    <section aria-labelledby="location-heading" data-testid="stay-location">
      <h2 id="location-heading" className="mb-4 font-serif text-2xl font-medium">Where you'll be</h2>
      <div className="overflow-hidden rounded-2xl border border-border/70">
        {/* A map-like backdrop drawn in CSS: nothing to download, and the button below does the work. */}
        <div
          aria-hidden="true"
          className="relative h-28 sm:h-36"
          style={{
            backgroundImage:
              "linear-gradient(135deg, hsl(var(--primary) / 0.16), hsl(var(--primary) / 0.04)), repeating-linear-gradient(0deg, hsl(var(--foreground) / 0.06) 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, hsl(var(--foreground) / 0.06) 0 1px, transparent 1px 28px)",
          }}
        >
          <span className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background shadow-md ring-4 ring-primary/20">
            <MapPin className="h-6 w-6 text-primary" />
          </span>
        </div>
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0">
            <p className="font-medium text-foreground" data-testid="text-stay-area">{stay.location}</p>
            <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
              {exact
                ? "Open the exact place in Google Maps to see what's around it and get directions."
                : "This opens the area in Google Maps. You'll get the exact location with your booking, once it's paid."}
            </p>
          </div>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-full border border-primary/40 bg-background px-5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
            data-testid={exact ? "link-stay-map-exact" : "link-stay-map-area"}
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {exact ? "Open in Google Maps" : "See the area in Google Maps"}
          </a>
        </div>
      </div>
    </section>
  );
}

function RuleGroup({ icon, title, lines }: { icon: ReactNode; title: string; lines: string[] }) {
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className="min-w-0">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon}
        {title}
      </h3>
      <ul className="space-y-1.5 text-sm leading-6 text-muted-foreground">
        {lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
    </div>
  );
}

/**
 * The rules a hotel or host set for their own place, as guests read them:
 * arrival and booking, children, and house rules. Nothing shows for a rule
 * that isn't set, and the section isn't there when none is.
 */
export function StayThingsToKnow({ stay }: { stay: StayForGuests }) {
  const rules = describeStayRules(stay);
  if (rules.arrival.length + rules.children.length + rules.house.length === 0 && !rules.note) {
    return null;
  }
  const hotel = isHotelStay(stay);
  return (
    <section aria-labelledby="things-to-know-heading" data-testid="stay-things-to-know">
      <h2 id="things-to-know-heading" className="mb-4 font-serif text-2xl font-medium">Things to know</h2>
      <div className="grid gap-6 rounded-2xl border border-border/70 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
        <RuleGroup icon={<CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />} title="Arrival and booking" lines={rules.arrival} />
        <RuleGroup icon={<Baby className="h-4 w-4 text-primary" aria-hidden="true" />} title="Children" lines={rules.children} />
        <RuleGroup icon={<Home className="h-4 w-4 text-primary" aria-hidden="true" />} title={hotel ? "Hotel rules" : "House rules"} lines={rules.house} />
        {rules.note ? (
          <p className="whitespace-pre-line rounded-xl bg-muted/40 p-3 text-sm leading-6 text-muted-foreground sm:col-span-2 lg:col-span-3">
            <span className="font-medium text-foreground">{hotel ? "From the hotel: " : "From your host: "}</span>
            {rules.note}
          </p>
        ) : null}
      </div>
    </section>
  );
}
