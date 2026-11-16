import { useState } from "react";
import { BedDouble, Maximize2, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CurrencyAmount } from "@/components/currency-amount";
import {
  describeChildPolicy,
  getCoveredGuests,
  getRoomBedsLabel,
  hasChildRates,
  mealPlans,
  sortRoomRates,
  summarizeHotelRooms,
  type HotelPolicy,
} from "@shared/hotel-rooms";
import type { StayRoomType } from "@shared/schema";

/** A room's photos: the cover, and the others to look through. */
function RoomPhotos({ roomType }: { roomType: StayRoomType }) {
  const photos = roomType.imageUrl
    ? [roomType.imageUrl, ...(roomType.galleryUrls ?? []).filter((url) => url && url !== roomType.imageUrl)]
    : (roomType.galleryUrls ?? []).filter(Boolean);
  const [shown, setShown] = useState(0);
  if (photos.length === 0) {
    return null;
  }
  const current = photos[Math.min(shown, photos.length - 1)];
  return (
    <div className="w-full sm:w-52 sm:shrink-0">
      <img src={current} alt={roomType.name} loading="lazy" className="aspect-[16/10] w-full object-cover sm:aspect-[4/3]" />
      {photos.length > 1 ? (
        <div className="flex gap-1.5 overflow-x-auto p-2" aria-label={`Photos of ${roomType.name}`}>
          {photos.map((url, index) => (
            <button
              key={url}
              type="button"
              onClick={() => setShown(index)}
              aria-label={`Photo ${index + 1} of ${photos.length}`}
              aria-pressed={index === shown}
              className={`h-11 w-14 shrink-0 overflow-hidden rounded-md border-2 transition-colors ${index === shown ? "border-primary" : "border-transparent opacity-80 hover:opacity-100"}`}
            >
              <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A hotel's rooms and what each costs per room per night on each meal plan,
 * with a button to book that room on that plan. `roomsLeft` (for the guest's
 * dates, when they chose some) marks rooms that are sold out or nearly.
 */
export function HotelRoomsSection({
  roomTypes,
  roomsLeft,
  hotelPolicy,
  onBook,
}: {
  roomTypes: StayRoomType[];
  roomsLeft?: Map<string, number>;
  hotelPolicy?: HotelPolicy | null;
  onBook: (roomTypeId: string, mealPlan: string) => void;
}) {
  const offeredPlans = summarizeHotelRooms(roomTypes).mealPlans;
  const takesChildren = hasChildRates(roomTypes);

  return (
    <section id="rooms" className="scroll-mt-24" aria-labelledby="rooms-heading">
      <h2 id="rooms-heading" className="mb-2 font-serif text-2xl font-medium">Rooms &amp; rates</h2>
      <p className="mb-5 text-sm text-muted-foreground">
        Prices are per room, per night, for the guests shown beside each price. Choose a room and a meal plan to book.
        {takesChildren ? ` ${describeChildPolicy(hotelPolicy)}` : ""}
      </p>

      <div className="space-y-4">
        {roomTypes.map((roomType) => {
          const left = roomsLeft?.get(roomType.id);
          const soldOut = left === 0;
          const covered = getCoveredGuests(roomType);
          const beds = getRoomBedsLabel(roomType);
          return (
            <Card key={roomType.id} className="overflow-hidden" data-testid={`room-type-${roomType.id}`}>
              <div className="flex flex-col sm:flex-row">
                <RoomPhotos roomType={roomType} />
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
                    {beds ? (
                      <span className="inline-flex items-center gap-1" data-testid={`room-beds-${roomType.id}`}>
                        <BedDouble className="h-4 w-4 shrink-0" />
                        {beds}
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
                              {covered === 1 ? "a night, for 1 guest" : `a night, for ${covered} sharing`}
                              {covered >= 2 ? (
                                <>
                                  {" · ≈ "}
                                  <CurrencyAmount amountUsd={Math.round(rate.price / covered)} primaryClassName="font-normal" />
                                  {` per person`}
                                </>
                              ) : null}
                            </div>
                            {rate.singlePrice && rate.singlePrice < rate.price ? (
                              <div className="text-[11px] text-muted-foreground">
                                {"One guest: "}
                                <CurrencyAmount amountUsd={rate.singlePrice} primaryClassName="font-normal" />
                              </div>
                            ) : null}
                            {rate.extraAdultPrice && covered < roomType.maxGuests ? (
                              <div className="text-[11px] text-muted-foreground">
                                {"Extra adult: + "}
                                <CurrencyAmount amountUsd={rate.extraAdultPrice} primaryClassName="font-normal" />
                              </div>
                            ) : null}
                            {rate.childPrice !== null && rate.childPrice !== undefined ? (
                              <div className="text-[11px] text-muted-foreground">
                                {rate.childPrice === 0 ? "Children stay free" : (
                                  <>
                                    {"Child: + "}
                                    <CurrencyAmount amountUsd={rate.childPrice} primaryClassName="font-normal" />
                                  </>
                                )}
                              </div>
                            ) : null}
                          </div>
                          <Button
                            size="sm"
                            className="min-h-11 shrink-0 rounded-full px-5 sm:min-h-9"
                            disabled={soldOut}
                            aria-label={`Book ${roomType.name}, ${mealPlans[rate.mealPlan].name}`}
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
