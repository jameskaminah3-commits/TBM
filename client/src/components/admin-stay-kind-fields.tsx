import { Building2, Home } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { StayPropertyType } from "@shared/hotel-rooms";

/** Facilities guests look for at a hotel, for the admin's checklist. */
export const hotelFacilityOptions = [
  "WiFi",
  "Pool",
  "Restaurant",
  "Bar",
  "Room service",
  "24-hour front desk",
  "Airport shuttle",
  "Spa",
  "Gym",
  "Beach access",
  "Kids' club",
  "Conference room",
  "Parking",
  "Air Conditioning",
  "Ocean View",
  "Wheelchair Accessible",
];

const kinds: Array<{ value: StayPropertyType; title: string; description: string; icon: typeof Home }> = [
  {
    value: "entire_place",
    title: "Entire place",
    description: "An apartment, villa or home, Airbnb style. Guests book the whole place at one price per night.",
    icon: Home,
  },
  {
    value: "hotel",
    title: "Hotel",
    description: "Guests book rooms by type, priced per room per night on meal plans (RO, BB, HB, FB, AI).",
    icon: Building2,
  },
];

/** Admin: whether a stay is an entire place or a hotel. */
export function StayKindPicker({
  value,
  onChange,
  disabledReason,
}: {
  value: StayPropertyType;
  onChange: (value: StayPropertyType) => void;
  /** Why the kind can't be changed right now, if it can't. */
  disabledReason?: string | null;
}) {
  return (
    <div className="space-y-2">
      <Label>Kind of stay</Label>
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Kind of stay">
        {kinds.map((kind) => {
          const Icon = kind.icon;
          const active = value === kind.value;
          return (
            <button
              key={kind.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={Boolean(disabledReason) && !active}
              onClick={() => onChange(kind.value)}
              className={cn(
                "flex min-w-0 items-start gap-3 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55",
                active ? "border-primary bg-primary/10 ring-1 ring-primary/30" : "hover:border-primary/40",
              )}
              data-testid={`stay-kind-${kind.value}`}
            >
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
              <span className="min-w-0">
                <span className="block font-medium">{kind.title}</span>
                <span className="block text-sm text-muted-foreground">{kind.description}</span>
              </span>
            </button>
          );
        })}
      </div>
      {disabledReason ? <p className="text-sm text-muted-foreground">{disabledReason}</p> : null}
    </div>
  );
}

/** Admin: a hotel's star rating and its check-in and check-out times (Kenya time). */
export function HotelDetailsFields({
  starRating,
  checkInTime,
  checkOutTime,
  onChange,
}: {
  starRating: number;
  checkInTime: string;
  checkOutTime: string;
  onChange: (next: { starRating?: number; checkInTime?: string; checkOutTime?: string }) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="space-y-2">
        <Label htmlFor="hotel-star-rating">Star rating</Label>
        <Select value={String(starRating || 0)} onValueChange={(value) => onChange({ starRating: Number(value) })}>
          <SelectTrigger id="hotel-star-rating" aria-label="Star rating">
            <SelectValue placeholder="Not rated" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Not rated</SelectItem>
            {[1, 2, 3, 4, 5].map((stars) => (
              <SelectItem key={stars} value={String(stars)}>{stars} star{stars === 1 ? "" : "s"}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="hotel-check-in">Check-in from</Label>
        <Input id="hotel-check-in" type="time" value={checkInTime} onChange={(event) => onChange({ checkInTime: event.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="hotel-check-out">Check-out by</Label>
        <Input id="hotel-check-out" type="time" value={checkOutTime} onChange={(event) => onChange({ checkOutTime: event.target.value })} />
      </div>
      <p className="text-sm text-muted-foreground sm:col-span-3">
        Times are Kenya time. Tick the hotel's facilities (pool, restaurant, spa, Wi-Fi…) under Hotel facilities below.
      </p>
    </div>
  );
}
