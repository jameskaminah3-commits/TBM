import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BedDouble, Maximize2, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminMediaField } from "@/components/admin-media-field";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/lib/currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { safeLocalStorage } from "@/lib/safe-storage";
import {
  bedSizePresets,
  checkRoomTypePricing,
  getCoveredGuests,
  getRoomBedsLabel,
  mealPlanCodes,
  mealPlans,
  sortRoomRates,
  type MealPlanCode,
  type RoomRate,
} from "@shared/hotel-rooms";
import type { StayRoomType } from "@shared/schema";

/** The team sets rates in US dollars; a hotel's owner types them in shillings or dollars. */
export type HotelRoomsEditorScope = "admin" | "provider";
type PriceCurrency = "USD" | "KES";

const PRICE_CURRENCY_KEY = "tbm-hotel-price-currency";
const CUSTOM_BED = "custom";

type RateDraft = { offered: boolean; price: string; singlePrice: string; extraAdultPrice: string; childPrice: string };
type BedDraft = { size: string; widthFt: string; lengthFt: string; count: string };

type RoomDraft = {
  name: string;
  description: string;
  beds: BedDraft[];
  /** What guests read for beds on a room saved before sizes were kept. */
  bedsInWords: string;
  sizeSqm: string;
  maxGuests: string;
  /** How many guests the price covers; "" is everyone the room sleeps. */
  standardGuests: string;
  roomCount: string;
  imageUrl: string;
  galleryUrls: string[];
  amenities: string;
  isActive: boolean;
  rates: Record<MealPlanCode, RateDraft>;
};

const bedKey = (widthFt: number, lengthFt: number) => `${widthFt}x${lengthFt}`;

function emptyRates(): Record<MealPlanCode, RateDraft> {
  return Object.fromEntries(
    mealPlanCodes.map((code) => [code, { offered: false, price: "", singlePrice: "", extraAdultPrice: "", childPrice: "" }]),
  ) as Record<MealPlanCode, RateDraft>;
}

function newBed(): BedDraft {
  return { size: bedKey(6, 6), widthFt: "6", lengthFt: "6", count: "1" };
}

const wholeNumber = (value: string) => /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
const feetNumber = (value: string) => /^\d+(\.\d{1,2})?$/.test(value.trim()) ? Number(value.trim()) : NaN;

/**
 * A hotel's room types, each with its beds, the guests it sleeps, its number
 * of rooms, and its price per room per night on each meal plan: for the
 * guests the price covers, for one guest alone, for each extra adult and for
 * each child.
 */
export function HotelRoomsEditor({ stayId, scope }: { stayId: string; scope: HotelRoomsEditorScope }) {
  const { toast } = useToast();
  const { usdToKes } = useCurrency();
  const isOwner = scope === "provider";
  const [currency, setCurrencyState] = useState<PriceCurrency>(() =>
    isOwner && safeLocalStorage.getItem(PRICE_CURRENCY_KEY) !== "USD" ? "KES" : "USD");
  const [editing, setEditing] = useState<StayRoomType | "new" | null>(null);
  const [draft, setDraft] = useState<RoomDraft | null>(null);
  const [deleting, setDeleting] = useState<StayRoomType | null>(null);
  const apiBase = `/api/${scope}/stays/${stayId}/room-types`;
  const roomTypesKey = [`/api/${scope}/stays`, stayId, "room-types"];

  const setCurrency = (next: PriceCurrency) => {
    setCurrencyState(next);
    safeLocalStorage.setItem(PRICE_CURRENCY_KEY, next);
  };

  // Rates are kept in whole US dollars, whatever currency they're typed in.
  const fromUsd = (amountUsd: number) => (currency === "USD" ? amountUsd : Math.round(amountUsd * usdToKes));
  const toUsd = (amount: number) => (currency === "USD" ? amount : amount <= 0 ? 0 : Math.max(1, Math.round(amount / usdToKes)));
  const money = (amountUsd: number) =>
    currency === "USD" ? `US$${amountUsd.toLocaleString("en-US")}` : `KSh ${fromUsd(amountUsd).toLocaleString("en-KE")}`;
  const currencyWords = currency === "USD" ? "whole US dollars" : "Kenya shillings";
  const currencyMark = currency === "USD" ? "US$" : "KSh";

  const { data: roomTypes = [], isLoading } = useQuery<StayRoomType[]>({
    queryKey: roomTypesKey,
    queryFn: async () => {
      const response = await fetch(apiBase, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch room types");
      return response.json();
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: roomTypesKey });
    queryClient.invalidateQueries({ queryKey: [`/api/${scope}/stays`] });
    queryClient.invalidateQueries({ queryKey: ["/api/provider/stays", stayId] });
    queryClient.invalidateQueries({ queryKey: ["/api/provider/stays", stayId, "calendar-sync"] });
    queryClient.invalidateQueries({ queryKey: ["/api/stays"] });
  };
  const errorText = (error: Error) => error.message.replace(/^\d+:\s*/, "");

  const toDraft = (roomType?: StayRoomType | null): RoomDraft => {
    const rates = emptyRates();
    const shown = (amount: number | null | undefined) => (amount === null || amount === undefined ? "" : String(fromUsd(amount)));
    for (const rate of roomType?.rates ?? []) {
      rates[rate.mealPlan] = {
        offered: true,
        price: shown(rate.price),
        singlePrice: rate.singlePrice ? shown(rate.singlePrice) : "",
        extraAdultPrice: rate.extraAdultPrice ? shown(rate.extraAdultPrice) : "",
        childPrice: shown(rate.childPrice),
      };
    }
    const standard = roomType?.standardGuests;
    return {
      name: roomType?.name ?? "",
      description: roomType?.description ?? "",
      beds: (roomType?.beds ?? []).map((bed) => {
        const key = bedKey(bed.widthFt, bed.lengthFt);
        const isPreset = bedSizePresets.some((preset) => bedKey(preset.widthFt, preset.lengthFt) === key);
        return { size: isPreset ? key : CUSTOM_BED, widthFt: String(bed.widthFt), lengthFt: String(bed.lengthFt), count: String(bed.count) };
      }),
      bedsInWords: roomType?.bedType ?? "",
      sizeSqm: roomType?.sizeSqm ? String(roomType.sizeSqm) : "",
      maxGuests: roomType ? String(roomType.maxGuests) : "2",
      standardGuests: roomType && standard && standard < roomType.maxGuests ? String(standard) : "",
      roomCount: roomType ? String(roomType.roomCount) : "1",
      imageUrl: roomType?.imageUrl ?? "",
      galleryUrls: roomType?.galleryUrls ?? [],
      amenities: (roomType?.amenities ?? []).join(", "),
      isActive: roomType?.isActive ?? true,
      rates,
    };
  };

  const toPayload = (room: RoomDraft) => {
    const maxGuests = wholeNumber(room.maxGuests);
    const standard = room.standardGuests.trim() ? wholeNumber(room.standardGuests) : NaN;
    const sleepsMore = standard >= 1 && standard < maxGuests;
    const optional = (value: string) => (value.trim() ? toUsd(wholeNumber(value)) : null);
    const gallery = room.imageUrl ? [room.imageUrl, ...room.galleryUrls.filter((url) => url && url !== room.imageUrl)] : room.galleryUrls.filter(Boolean);
    return {
      name: room.name.trim(),
      description: room.description.trim(),
      beds: room.beds.map((bed) => ({ widthFt: feetNumber(bed.widthFt), lengthFt: feetNumber(bed.lengthFt), count: wholeNumber(bed.count) })),
      sizeSqm: room.sizeSqm.trim() ? wholeNumber(room.sizeSqm) : null,
      maxGuests,
      standardGuests: sleepsMore ? standard : null,
      roomCount: wholeNumber(room.roomCount),
      imageUrl: gallery[0] ?? null,
      galleryUrls: gallery.slice(0, 12),
      amenities: room.amenities.split(",").map((amenity) => amenity.trim()).filter(Boolean),
      isActive: room.isActive,
      rates: mealPlanCodes
        .filter((code) => room.rates[code].offered)
        .map((code): RoomRate => ({
          mealPlan: code,
          price: toUsd(wholeNumber(room.rates[code].price)),
          singlePrice: optional(room.rates[code].singlePrice),
          extraAdultPrice: sleepsMore ? optional(room.rates[code].extraAdultPrice) : null,
          childPrice: optional(room.rates[code].childPrice),
        })),
    };
  };

  /** What's missing or wrong in the room form, in words, or null when it can be saved. */
  const checkDraft = (room: RoomDraft): string | null => {
    if (room.name.trim().length < 2) return "Give the room type a name, like \"Deluxe Double\".";
    const maxGuests = wholeNumber(room.maxGuests);
    if (!(maxGuests >= 1)) return "Say how many guests one room sleeps.";
    if (room.standardGuests.trim() && !(wholeNumber(room.standardGuests) >= 1 && wholeNumber(room.standardGuests) <= maxGuests)) {
      return "The guests the price covers can't be more than the room sleeps.";
    }
    if (!(wholeNumber(room.roomCount) >= 1)) return "Say how many rooms of this type the hotel sells through us.";
    if (room.sizeSqm.trim() && !(wholeNumber(room.sizeSqm) >= 1)) return "The room size is a whole number of square metres.";
    for (const bed of room.beds) {
      if (!(wholeNumber(bed.count) >= 1)) return "Say how many beds of each size the room has.";
      if (!(feetNumber(bed.widthFt) >= 2 && feetNumber(bed.widthFt) <= 12) || !(feetNumber(bed.lengthFt) >= 4 && feetNumber(bed.lengthFt) <= 12)) {
        return "Give each bed's width and length in feet, like 6 by 6.";
      }
    }
    const offered = mealPlanCodes.filter((code) => room.rates[code].offered);
    if (offered.length === 0) return "Tick at least one meal plan and give its price.";
    for (const code of offered) {
      const rate = room.rates[code];
      const plan = mealPlans[code].name.toLowerCase();
      if (!(wholeNumber(rate.price) >= 1)) return `Give the ${plan} price per room per night, in ${currencyWords}.`;
      for (const [value, what] of [[rate.singlePrice, "for one guest"], [rate.extraAdultPrice, "for each extra adult"]] as const) {
        if (value.trim() && !(wholeNumber(value) >= 1)) return `The ${plan} price ${what} is in ${currencyWords}.`;
      }
      if (rate.childPrice.trim() && !(wholeNumber(rate.childPrice) >= 0)) return `The ${plan} price for each child is in ${currencyWords} (0 if children stay free).`;
    }
    return checkRoomTypePricing(toPayload(room));
  };

  const saveMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string | null; payload: Record<string, unknown> }) => {
      const response = id ? await apiRequest("PATCH", `${apiBase}/${id}`, payload) : await apiRequest("POST", apiBase, payload);
      return response.json() as Promise<StayRoomType>;
    },
    onSuccess: (roomType, variables) => {
      refresh();
      setEditing(null);
      toast({
        title: variables.id ? "Room updated" : "Room added",
        description: isOwner ? `${roomType.name} is live. TBM reviews your changes afterwards.` : `${roomType.name} is saved with its meal plans.`,
      });
    },
    onError: (error: Error) => toast({ title: "Could not save the room", description: errorText(error), variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async (roomType: StayRoomType) => {
      const response = await apiRequest("PATCH", `${apiBase}/${roomType.id}`, { isActive: !roomType.isActive });
      return response.json() as Promise<StayRoomType>;
    },
    onSuccess: (roomType) => {
      refresh();
      toast({
        title: roomType.isActive ? "Back on sale" : "Stopped selling",
        description: roomType.isActive ? `Guests can book ${roomType.name} again.` : `Guests can't book ${roomType.name}; existing bookings keep it.`,
      });
    },
    onError: (error: Error) => toast({ title: "Could not update the room", description: errorText(error), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (roomType: StayRoomType) => {
      await apiRequest("DELETE", `${apiBase}/${roomType.id}`);
      return roomType;
    },
    onSuccess: (roomType) => {
      refresh();
      setDeleting(null);
      toast({ title: "Room removed", description: `${roomType.name} is no longer listed.` });
    },
    onError: (error: Error) => {
      setDeleting(null);
      toast({ title: "Could not remove the room", description: errorText(error), variant: "destructive" });
    },
  });

  const openEditor = (roomType: StayRoomType | "new") => {
    setDraft(toDraft(roomType === "new" ? null : roomType));
    setEditing(roomType);
  };
  const update = (next: Partial<RoomDraft>) => setDraft((current) => (current ? { ...current, ...next } : current));
  const setRate = (code: MealPlanCode, next: Partial<RateDraft>) =>
    setDraft((current) => (current ? { ...current, rates: { ...current.rates, [code]: { ...current.rates[code], ...next } } } : current));
  const setBed = (index: number, next: Partial<BedDraft>) =>
    setDraft((current) => (current ? { ...current, beds: current.beds.map((bed, at) => (at === index ? { ...bed, ...next } : bed)) } : current));

  const draftProblem = draft ? checkDraft(draft) : null;
  const draftMaxGuests = draft ? wholeNumber(draft.maxGuests) : NaN;
  const draftCovered = draft && draft.standardGuests.trim() && wholeNumber(draft.standardGuests) < draftMaxGuests
    ? wholeNumber(draft.standardGuests)
    : draftMaxGuests;
  const draftSleepsMore = draftCovered >= 1 && draftCovered < draftMaxGuests;
  const coveredWords = (covered: number) => (covered === 1 ? "1 guest" : `${covered} sharing`);

  return (
    <Card id="rooms" className="scroll-mt-24" data-testid="hotel-rooms-editor">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle>Rooms &amp; rates</CardTitle>
          <CardDescription>
            Each room type: its beds, how many rooms {isOwner ? "you sell" : "the hotel sells"} through us, and its price per night on each meal plan,
            for a couple, one guest, an extra adult and a child. The hotel's "from" price, guests and rooms on the site follow from these.
          </CardDescription>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isOwner ? (
            <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="Currency you type prices in">
              {(["KES", "USD"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setCurrency(code)}
                  aria-pressed={currency === code}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${currency === code ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  data-testid={`price-currency-${code}`}
                >
                  {code === "KES" ? "KSh" : "US$"}
                </button>
              ))}
            </div>
          ) : null}
          <Button type="button" onClick={() => openEditor("new")} data-testid="button-add-room">
            <Plus className="mr-2 h-4 w-4" />
            Add room type
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading rooms…</p> : null}
        {!isLoading && roomTypes.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No rooms yet. Guests see this hotel once it has at least one room type with a price.
          </div>
        ) : null}
        {roomTypes.map((roomType) => {
          const covered = getCoveredGuests(roomType);
          const beds = getRoomBedsLabel(roomType);
          return (
            <div key={roomType.id} className="rounded-xl border p-4" data-testid={`room-${roomType.id}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-3">
                  {roomType.imageUrl ? (
                    <img src={roomType.imageUrl} alt="" loading="lazy" className="hidden h-20 w-24 shrink-0 rounded-lg object-cover sm:block" />
                  ) : null}
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{roomType.name}</span>
                      <Badge variant={roomType.isActive ? "secondary" : "outline"}>{roomType.isActive ? "On sale" : "Not on sale"}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5 shrink-0" />Sleeps {roomType.maxGuests}</span>
                      <span className="inline-flex items-center gap-1"><BedDouble className="h-3.5 w-3.5 shrink-0" />{roomType.roomCount} room{roomType.roomCount === 1 ? "" : "s"}{beds ? ` · ${beds}` : ""}</span>
                      {roomType.sizeSqm ? <span className="inline-flex items-center gap-1"><Maximize2 className="h-3.5 w-3.5 shrink-0" />{roomType.sizeSqm} m²</span> : null}
                    </div>
                    <div className="space-y-1 pt-1">
                      {sortRoomRates(roomType.rates).map((rate) => (
                        <div key={rate.mealPlan} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                          <span className="rounded-full border bg-muted/40 px-2 py-0.5 font-semibold">{rate.mealPlan}</span>
                          <span><span className="font-medium">{money(rate.price)}</span> <span className="text-muted-foreground">{coveredWords(covered)}</span></span>
                          {rate.singlePrice ? <span className="text-muted-foreground">· 1 guest {money(rate.singlePrice)}</span> : null}
                          {rate.extraAdultPrice && covered < roomType.maxGuests ? <span className="text-muted-foreground">· extra adult {money(rate.extraAdultPrice)}</span> : null}
                          {rate.childPrice !== null && rate.childPrice !== undefined ? (
                            <span className="text-muted-foreground">· child {rate.childPrice === 0 ? "free" : money(rate.childPrice)}</span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => openEditor(roomType)} data-testid={`button-edit-room-${roomType.id}`}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />Edit
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={toggleMutation.isPending} onClick={() => toggleMutation.mutate(roomType)}>
                    {roomType.isActive ? "Stop selling" : "Start selling"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => setDeleting(roomType)} aria-label={`Remove ${roomType.name}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="max-h-[95vh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto sm:w-full">
          <DialogHeader>
            <DialogTitle>{editing === "new" || editing === null ? "Add a room type" : `Edit ${editing.name}`}</DialogTitle>
            <DialogDescription>
              Prices are per room, per night, in {currencyWords}.
              {currency === "KES" ? " We keep them in US dollars, so a shilling amount can come back a few shillings different." : ""}
            </DialogDescription>
          </DialogHeader>

          {draft ? (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="room-name">Room type</Label>
                  <Input id="room-name" placeholder="Deluxe Double, Sea View" value={draft.name} onChange={(event) => update({ name: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="room-count">Rooms of this type</Label>
                  <Input id="room-count" type="number" min="1" inputMode="numeric" value={draft.roomCount} onChange={(event) => update({ roomCount: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="room-size">Size in m² (optional)</Label>
                  <Input id="room-size" type="number" min="1" inputMode="numeric" value={draft.sizeSqm} onChange={(event) => update({ sizeSqm: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="room-sleeps">Sleeps (most guests in a room)</Label>
                  <Input id="room-sleeps" type="number" min="1" inputMode="numeric" value={draft.maxGuests} onChange={(event) => update({ maxGuests: event.target.value })} />
                  <p className="text-xs text-muted-foreground">Adults and children together.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="room-covered">The room price is for</Label>
                  <select
                    id="room-covered"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={draftSleepsMore ? String(draftCovered) : ""}
                    onChange={(event) => update({ standardGuests: event.target.value })}
                  >
                    <option value="">Everyone it sleeps</option>
                    {Array.from({ length: Math.max(0, Math.min(draftMaxGuests || 0, 20) - 1) }, (_, index) => index + 1).map((count) => (
                      <option key={count} value={count}>{count === 1 ? "1 guest" : `${count} guests sharing`}</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">A double that takes an extra bed sleeps 3 and is priced for 2 sharing.</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Beds, in feet</Label>
                {draft.beds.length === 0 && draft.bedsInWords ? (
                  <p className="text-xs text-muted-foreground">Guests now read "{draft.bedsInWords}". Add the bed sizes to show them in feet instead.</p>
                ) : null}
                <div className="space-y-2">
                  {draft.beds.map((bed, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5" data-testid={`room-bed-${index}`}>
                      <Input
                        type="number"
                        min="1"
                        inputMode="numeric"
                        aria-label="How many beds of this size"
                        className="w-16"
                        value={bed.count}
                        onChange={(event) => setBed(index, { count: event.target.value })}
                      />
                      <span className="text-sm text-muted-foreground">×</span>
                      <select
                        aria-label="Bed size"
                        className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={bed.size}
                        onChange={(event) => {
                          const preset = bedSizePresets.find((entry) => bedKey(entry.widthFt, entry.lengthFt) === event.target.value);
                          setBed(index, preset
                            ? { size: event.target.value, widthFt: String(preset.widthFt), lengthFt: String(preset.lengthFt) }
                            : { size: CUSTOM_BED });
                        }}
                      >
                        {bedSizePresets.map((preset) => (
                          <option key={bedKey(preset.widthFt, preset.lengthFt)} value={bedKey(preset.widthFt, preset.lengthFt)}>
                            {preset.widthFt}ft by {preset.lengthFt}ft ({preset.name})
                          </option>
                        ))}
                        <option value={CUSTOM_BED}>Another size…</option>
                      </select>
                      {bed.size === CUSTOM_BED ? (
                        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Input type="number" min="2" max="12" step="0.5" inputMode="decimal" aria-label="Bed width in feet" className="w-20" value={bed.widthFt} onChange={(event) => setBed(index, { widthFt: event.target.value })} />
                          ft by
                          <Input type="number" min="4" max="12" step="0.5" inputMode="decimal" aria-label="Bed length in feet" className="w-20" value={bed.lengthFt} onChange={(event) => setBed(index, { lengthFt: event.target.value })} />
                          ft
                        </span>
                      ) : null}
                      <Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0" aria-label="Remove this bed" onClick={() => update({ beds: draft.beds.filter((_, at) => at !== index) })}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                {draft.beds.length < 8 ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => update({ beds: [...draft.beds, newBed()] })} data-testid="button-add-bed">
                    <Plus className="mr-1.5 h-3.5 w-3.5" />Add a bed
                  </Button>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label>Meal plans and prices ({currencyMark} per room per night)</Label>
                <div className="space-y-2">
                  {mealPlanCodes.map((code) => {
                    const rate = draft.rates[code];
                    const plan = mealPlans[code].name;
                    return (
                      <div key={code} className="rounded-xl border p-3" data-testid={`room-rate-${code}`}>
                        <label className="flex min-w-0 items-start gap-2">
                          <Checkbox
                            checked={rate.offered}
                            onCheckedChange={(checked) => setRate(code, { offered: checked === true })}
                            aria-label={`Offer ${plan}`}
                            className="mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{plan} ({code})</span>
                            <span className="block text-xs text-muted-foreground">{mealPlans[code].includes}</span>
                          </span>
                        </label>
                        {rate.offered ? (
                          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <div className="space-y-1">
                              <Label htmlFor={`rate-${code}-price`} className="text-xs font-normal text-muted-foreground">
                                {Number.isFinite(draftCovered) ? (draftCovered === 1 ? "1 guest" : `${draftCovered} sharing`) : "Room"}
                              </Label>
                              <Input id={`rate-${code}-price`} type="number" min="1" inputMode="numeric" placeholder={currencyMark} value={rate.price} onChange={(event) => setRate(code, { price: event.target.value })} />
                            </div>
                            {draftCovered !== 1 ? (
                              <div className="space-y-1">
                                <Label htmlFor={`rate-${code}-single`} className="text-xs font-normal text-muted-foreground">1 guest alone</Label>
                                <Input id={`rate-${code}-single`} type="number" min="1" inputMode="numeric" placeholder="Same price" value={rate.singlePrice} onChange={(event) => setRate(code, { singlePrice: event.target.value })} />
                              </div>
                            ) : null}
                            {draftSleepsMore ? (
                              <div className="space-y-1">
                                <Label htmlFor={`rate-${code}-extra`} className="text-xs font-normal text-muted-foreground">Each extra adult</Label>
                                <Input id={`rate-${code}-extra`} type="number" min="1" inputMode="numeric" placeholder={currencyMark} value={rate.extraAdultPrice} onChange={(event) => setRate(code, { extraAdultPrice: event.target.value })} />
                              </div>
                            ) : null}
                            <div className="space-y-1">
                              <Label htmlFor={`rate-${code}-child`} className="text-xs font-normal text-muted-foreground">Each child</Label>
                              <Input id={`rate-${code}-child`} type="number" min="0" inputMode="numeric" placeholder="As an adult" value={rate.childPrice} onChange={(event) => setRate(code, { childPrice: event.target.value })} />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  If you quote per person sharing, multiply by the guests the price is for. Leave "1 guest alone" empty to charge one guest the room price.
                  For children, type 0 if they stay free, or leave it empty to charge a child as an adult.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="room-description">Description (optional)</Label>
                  <Textarea id="room-description" rows={2} value={draft.description} onChange={(event) => update({ description: event.target.value })} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="room-amenities">Room amenities (comma separated)</Label>
                  <Input id="room-amenities" placeholder="Air conditioning, Balcony, Sea view" value={draft.amenities} onChange={(event) => update({ amenities: event.target.value })} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Room photos (up to 12; the first is the cover)</Label>
                  <AdminMediaField
                    value={draft.imageUrl}
                    galleryUrls={draft.galleryUrls}
                    mediaType="image"
                    onChange={({ mediaUrl, mediaType, galleryUrls }) => {
                      if (mediaType === "video") {
                        toast({ title: "Use photos", description: "A room's pictures are photos.", variant: "destructive" });
                        return;
                      }
                      update({ imageUrl: mediaUrl, galleryUrls });
                    }}
                  />
                </div>
              </div>

              <label className="flex items-center justify-between gap-4 rounded-xl border p-3">
                <span>
                  <span className="block text-sm font-medium">On sale</span>
                  <span className="block text-xs text-muted-foreground">Turn off to stop guests booking this room. Bookings already made keep it.</span>
                </span>
                <Switch checked={draft.isActive} onCheckedChange={(checked) => update({ isActive: checked })} aria-label="On sale" />
              </label>

              {draftProblem ? <p className="text-sm text-muted-foreground" data-testid="room-form-hint">{draftProblem}</p> : null}
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              type="button"
              disabled={!draft || Boolean(draftProblem) || saveMutation.isPending}
              onClick={() => draft && saveMutation.mutate({ id: editing && editing !== "new" ? editing.id : null, payload: toPayload(draft) })}
              data-testid="button-save-room"
            >
              {saveMutation.isPending ? "Saving…" : "Save room"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Guests will no longer see this room. A room with upcoming bookings can't be removed: stop selling it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && deleteMutation.mutate(deleting)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
