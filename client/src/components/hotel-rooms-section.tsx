import { BedDouble, Maximize2, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CurrencyAmount } from "@/components/currency-amount";
import { mealPlans, sortRoomRates, summarizeHotelRooms } from "@shared/hotel-rooms";
import type { StayRoomType } from "@shared/schema";

/**
 * A hotel's rooms and what each costs per room per night on each meal plan,
 * with a button to book that room on that plan. `roomsLeft` (for the guest's
 * dates, when they chose some) marks rooms that are sold out or nearly.
 */
export function HotelRoomsSection({
  roomTypes,
  roomsLeft,
  onBook,
}: {
  roomTypes: StayRoomType[];
  roomsLeft?: Map<string, number>;
  onBook: (roomTypeId: string, mealPlan: string) => void;
}) {
  const offeredPlans = summarizeHotelRooms(roomTypes).mealPlans;

  return (
    <section id="rooms" className="scroll-mt-24" aria-labelledby="rooms-heading">
      <h2 id="rooms-heading" className="mb-2 font-serif text-2xl font-medium">Rooms &amp; rates</h2>
      <p className="mb-5 text-sm text-muted-foreground">
        Prices are per room, per night, for up to the guests each room sleeps. Choose a room and a meal plan to book.
      </p>

      <div className="space-y-4">
        {roomTypes.map((roomType) => {
          const left = roomsLeft?.get(roomType.id);
          const soldOut = left === 0;
          return (
            <Card key={roomType.id} className="overflow-hidden" data-testid={`room-type-${roomType.id}`}>
              <div className="flex flex-col sm:flex-row">
                {roomType.imageUrl ? (
                  <img
                    src={roomType.imageUrl}
                    alt={roomType.name}
                    loading="lazy"
                    className="aspect-[16/10] w-full object-cover sm:aspect-auto sm:w-48 sm:shrink-0"
                  />
                ) : null}
                <div className="min-w-0 flex-1 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-serif text-xl font-medium leading-tight">{roomType.name}</h3>
                    {left !== undefined ? (
                      <Badge variant={soldOut ? "destructive" : "secondary"} className="shrink-0">
                        {soldOut ? "Fully booked for your dates" : left <= 3 ? `Only ${left} left for your dates` : "Available for your dates"}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-4 w-4 shrink-0" />
                      Sleeps {roomType.maxGuests}
                    </span>
                    {roomType.bedType ? (
                      <span className="inline-flex items-center gap-1">
                        <BedDouble className="h-4 w-4 shrink-0" />
                        {roomType.bedType}
                      </span>
                    ) : null}
                    {roomType.sizeSqm ? (
                      <span className="inline-flex items-center gap-1">
                        <Maximize2 className="h-4 w-4 shrink-0" />
                        {roomType.sizeSqm} m²
                      </span>
                    ) : null}
                  </div>
                  {roomType.description ? (
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{roomType.description}</p>
                  ) : null}
                  {roomType.amenities.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {roomType.amenities.map((amenity) => (
                        <Badge key={amenity} variant="outline" className="text-[11px] font-normal">{amenity}</Badge>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-4 divide-y rounded-xl border">
                    {sortRoomRates(roomType.rates).map((rate) => (
                      <div
                        key={rate.mealPlan}
                        className="flex flex-col gap-3 p-3 min-[520px]:flex-row min-[520px]:items-center min-[520px]:justify-between"
                        data-testid={`rate-${roomType.id}-${rate.mealPlan}`}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">
                            {mealPlans[rate.mealPlan].name}
                            <span className="ml-1.5 text-xs font-medium text-muted-foreground">({rate.mealPlan})</span>
                          </div>
                          <div className="text-xs text-muted-foreground">{mealPlans[rate.mealPlan].includes}</div>
                        </div>
                        <div className="flex items-center justify-between gap-3 min-[520px]:justify-end">
                          <div className="text-left min-[520px]:text-right">
                            <CurrencyAmount amountUsd={rate.price} primaryClassName="text-base font-semibold" />
                            <div className="text-[11px] text-muted-foreground">
                              per room / night
                              {roomType.maxGuests >= 2 ? (
                                <>
                                  {" · ≈ "}
                                  <CurrencyAmount amountUsd={Math.round(rate.price / roomType.maxGuests)} primaryClassName="font-normal" />
                                  {` per person sharing`}
                                </>
                              ) : null}
                            </div>
                            {rate.singlePrice && rate.singlePrice < rate.price ? (
                              <div className="text-[11px] text-muted-foreground">
                                {"One guest: "}
                                <CurrencyAmount amountUsd={rate.singlePrice} primaryClassName="font-normal" />
                              </div>
                            ) : null}
                          </div>
                          <Button
                            size="sm"
                            className="shrink-0 rounded-full px-4"
                            disabled={soldOut}
                            onClick={() => onBook(roomType.id, rate.mealPlan)}
                            data-testid={`button-book-room-${roomType.id}-${rate.mealPlan}`}
                          >
                            Book
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {offeredPlans.length > 0 ? (
        <div className="mt-5 rounded-xl border bg-muted/30 p-4">
          <div className="mb-2 text-sm font-semibold">What the meal plans include</div>
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {offeredPlans.map((code) => (
              <div key={code} className="flex gap-2">
                <dt className="w-10 shrink-0 font-semibold">{code}</dt>
                <dd className="text-muted-foreground">
                  {mealPlans[code].name}: {mealPlans[code].includes.charAt(0).toLowerCase()}{mealPlans[code].includes.slice(1)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </section>
  );
}
