import { BedDouble, Minus, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrencyAmount } from "@/components/currency-amount";
import { cn } from "@/lib/utils";
import { mealPlans, sortRoomRates, type HotelRoomQuote } from "@shared/hotel-rooms";
import type { StayRoomType } from "@shared/schema";

/**
 * Booking a hotel: which room, on which meal plan, and how many rooms. Prices
 * are per room per night; `roomsLeft` (for the chosen dates) marks rooms that
 * are sold out or nearly, and `quote` says what the choice costs, or why it
 * can't be booked.
 */
export function HotelRoomPicker({
  roomTypes,
  roomsLeft,
  roomTypeId,
  mealPlan,
  roomCount,
  quote,
  nights,
  onChange,
}: {
  roomTypes: StayRoomType[];
  roomsLeft?: Map<string, number>;
  roomTypeId: string | null | undefined;
  mealPlan: string | null | undefined;
  roomCount: number;
  quote: HotelRoomQuote | null;
  nights: number;
  onChange: (next: { roomTypeId?: string; mealPlan?: string; roomCount?: number }) => void;
}) {
  const selected = roomTypes.find((roomType) => roomType.id === roomTypeId) ?? null;
  const left = selected ? roomsLeft?.get(selected.id) : undefined;
  const maxRooms = selected ? Math.max(1, Math.min(selected.roomCount, left ?? selected.roomCount)) : 1;

  return (
    <div className="space-y-5" data-testid="hotel-room-picker">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Room</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {roomTypes.map((roomType) => {
            const active = roomType.id === roomTypeId;
            const roomLeft = roomsLeft?.get(roomType.id);
            const fromPrice = Math.min(...roomType.rates.map((rate) => rate.price));
            return (
              <button
                key={roomType.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={roomLeft === 0}
                onClick={() => {
                  const keepPlan = roomType.rates.some((rate) => rate.mealPlan === mealPlan);
                  onChange({
                    roomTypeId: roomType.id,
                    mealPlan: keepPlan ? mealPlan ?? undefined : sortRoomRates(roomType.rates)[0]?.mealPlan,
                  });
                }}
                className={cn(
                  "min-w-0 rounded-2xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55",
                  active ? "border-primary bg-primary/10 ring-1 ring-primary/30" : "border-border/70 bg-background/60 hover:border-primary/40",
                )}
                data-testid={`picker-room-${roomType.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold leading-tight">{roomType.name}</span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground">
                    from <CurrencyAmount amountUsd={fromPrice} primaryClassName="font-semibold text-foreground" />
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5 shrink-0" />Sleeps {roomType.maxGuests}</span>
                  {roomType.bedType ? (
                    <span className="inline-flex items-center gap-1"><BedDouble className="h-3.5 w-3.5 shrink-0" />{roomType.bedType}</span>
                  ) : null}
                </div>
                {roomLeft !== undefined ? (
                  <div className={cn("mt-1.5 text-xs font-medium", roomLeft === 0 ? "text-destructive" : roomLeft <= 3 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                    {roomLeft === 0 ? "Fully booked for your dates" : roomLeft <= 3 ? `Only ${roomLeft} left for your dates` : `${roomLeft} available for your dates`}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </fieldset>

      {selected ? (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Meal plan</legend>
          <div className="space-y-2" role="radiogroup" aria-label="Meal plan">
            {sortRoomRates(selected.rates).map((rate) => {
              const active = rate.mealPlan === mealPlan;
              return (
                <button
                  key={rate.mealPlan}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange({ mealPlan: rate.mealPlan })}
                  className={cn(
                    "flex w-full min-w-0 items-center justify-between gap-3 rounded-2xl border p-3 text-left transition-colors",
                    active ? "border-primary bg-primary/10 ring-1 ring-primary/30" : "border-border/70 bg-background/60 hover:border-primary/40",
                  )}
                  data-testid={`picker-plan-${rate.mealPlan}`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">
                      {mealPlans[rate.mealPlan].name}
                      <span className="ml-1.5 text-xs font-medium text-muted-foreground">({rate.mealPlan})</span>
                    </span>
                    <span className="block text-xs text-muted-foreground">{mealPlans[rate.mealPlan].includes}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <CurrencyAmount amountUsd={rate.price} primaryClassName="text-sm font-semibold" />
                    <span className="block text-[11px] text-muted-foreground">per room / night</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {selected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/60 p-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Rooms</div>
            <div className="text-xs text-muted-foreground">
              Up to {selected.maxGuests} guest{selected.maxGuests === 1 ? "" : "s"} per room
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-9 w-9 rounded-full"
              aria-label="Fewer rooms"
              disabled={roomCount <= 1}
              onClick={() => onChange({ roomCount: Math.max(1, roomCount - 1) })}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-8 text-center text-base font-semibold" aria-live="polite" data-testid="picker-room-count">{roomCount}</span>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-9 w-9 rounded-full"
              aria-label="More rooms"
              disabled={roomCount >= maxRooms}
              onClick={() => onChange({ roomCount: Math.min(maxRooms, roomCount + 1) })}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {quote && !quote.ok ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert" data-testid="picker-error">
          {quote.error}
        </p>
      ) : null}

      {quote && quote.ok && nights > 0 ? (
        <div className="rounded-xl border bg-muted/30 px-3 py-2 text-sm" data-testid="picker-quote">
          <div className="flex flex-wrap justify-between gap-2">
            <span className="text-muted-foreground">
              {quote.snapshot.rooms > 1 ? `${quote.snapshot.rooms} rooms` : "1 room"} × {nights} night{nights === 1 ? "" : "s"}
              {quote.snapshot.guestsPerRoom.length > 1 ? ` (${quote.snapshot.guestsPerRoom.join(" + ")} guests)` : ""}
            </span>
            <CurrencyAmount amountUsd={quote.snapshot.accommodationTotal} primaryClassName="font-semibold" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
