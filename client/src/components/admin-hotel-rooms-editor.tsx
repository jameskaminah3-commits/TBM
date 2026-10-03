import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BedDouble, Maximize2, Pencil, Plus, Trash2, Users } from "lucide-react";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { mealPlanCodes, mealPlans, sortRoomRates, type MealPlanCode } from "@shared/hotel-rooms";
import type { StayRoomType } from "@shared/schema";

type RateDraft = { offered: boolean; price: string; singlePrice: string };

type RoomDraft = {
  name: string;
  description: string;
  bedType: string;
  sizeSqm: string;
  maxGuests: string;
  roomCount: string;
  imageUrl: string;
  amenities: string;
  isActive: boolean;
  rates: Record<MealPlanCode, RateDraft>;
};

function emptyRates(): Record<MealPlanCode, RateDraft> {
  return Object.fromEntries(mealPlanCodes.map((code) => [code, { offered: false, price: "", singlePrice: "" }])) as Record<MealPlanCode, RateDraft>;
}

function toDraft(roomType?: StayRoomType | null): RoomDraft {
  const rates = emptyRates();
  for (const rate of roomType?.rates ?? []) {
    rates[rate.mealPlan] = { offered: true, price: String(rate.price), singlePrice: rate.singlePrice ? String(rate.singlePrice) : "" };
  }
  return {
    name: roomType?.name ?? "",
    description: roomType?.description ?? "",
    bedType: roomType?.bedType ?? "",
    sizeSqm: roomType?.sizeSqm ? String(roomType.sizeSqm) : "",
    maxGuests: roomType ? String(roomType.maxGuests) : "2",
    roomCount: roomType ? String(roomType.roomCount) : "1",
    imageUrl: roomType?.imageUrl ?? "",
    amenities: (roomType?.amenities ?? []).join(", "),
    isActive: roomType?.isActive ?? true,
    rates,
  };
}

/** Rates are set in whole US dollars, whatever currency the dashboard shows. */
const usd = (amount: number) => `US$${amount.toLocaleString("en-US")}`;

const wholeNumber = (value: string) => /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;

/** What's missing or wrong in the room form, in words, or null when it can be saved. */
function checkDraft(draft: RoomDraft): string | null {
  if (draft.name.trim().length < 2) return "Give the room type a name, like \"Deluxe Double\".";
  if (!(wholeNumber(draft.maxGuests) >= 1)) return "Say how many guests one room sleeps.";
  if (!(wholeNumber(draft.roomCount) >= 1)) return "Say how many rooms of this type the hotel sells through us.";
  if (draft.sizeSqm.trim() && !(wholeNumber(draft.sizeSqm) >= 1)) return "The room size is a whole number of square metres.";
  const offered = mealPlanCodes.filter((code) => draft.rates[code].offered);
  if (offered.length === 0) return "Tick at least one meal plan and give its price.";
  for (const code of offered) {
    const rate = draft.rates[code];
    const price = wholeNumber(rate.price);
    if (!(price >= 1)) return `Give the ${mealPlans[code].name.toLowerCase()} price per room per night, in whole US dollars.`;
    if (rate.singlePrice.trim()) {
      const single = wholeNumber(rate.singlePrice);
      if (!(single >= 1)) return `The ${mealPlans[code].name.toLowerCase()} price for one guest is in whole US dollars.`;
      if (single > price) return `The ${mealPlans[code].name.toLowerCase()} price for one guest can't be more than the room's price.`;
    }
  }
  return null;
}

function toPayload(draft: RoomDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    bedType: draft.bedType.trim(),
    sizeSqm: draft.sizeSqm.trim() ? wholeNumber(draft.sizeSqm) : null,
    maxGuests: wholeNumber(draft.maxGuests),
    roomCount: wholeNumber(draft.roomCount),
    imageUrl: draft.imageUrl.trim() || null,
    amenities: draft.amenities.split(",").map((amenity) => amenity.trim()).filter(Boolean),
    isActive: draft.isActive,
    rates: mealPlanCodes
      .filter((code) => draft.rates[code].offered)
      .map((code) => ({
        mealPlan: code,
        price: wholeNumber(draft.rates[code].price),
        singlePrice: draft.rates[code].singlePrice.trim() ? wholeNumber(draft.rates[code].singlePrice) : null,
      })),
  };
}

/**
 * Admin: a hotel's room types, each with its number of rooms, the guests one
 * room sleeps, and its price per room per night on each meal plan it offers.
 */
export function AdminHotelRoomsEditor({ stayId }: { stayId: string }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<StayRoomType | "new" | null>(null);
  const [draft, setDraft] = useState<RoomDraft>(() => toDraft());
  const [deleting, setDeleting] = useState<StayRoomType | null>(null);
  const roomTypesKey = ["/api/admin/stays", stayId, "room-types"];

  const { data: roomTypes = [], isLoading } = useQuery<StayRoomType[]>({
    queryKey: roomTypesKey,
    queryFn: async () => {
      const response = await fetch(`/api/admin/stays/${stayId}/room-types`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch room types");
      return response.json();
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: roomTypesKey });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/stays"] });
    queryClient.invalidateQueries({ queryKey: ["/api/stays"] });
  };
  const errorText = (error: Error) => error.message.replace(/^\d+:\s*/, "");

  const saveMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string | null; payload: Record<string, unknown> }) => {
      const response = id
        ? await apiRequest("PATCH", `/api/admin/stays/${stayId}/room-types/${id}`, payload)
        : await apiRequest("POST", `/api/admin/stays/${stayId}/room-types`, payload);
      return response.json() as Promise<StayRoomType>;
    },
    onSuccess: (roomType, variables) => {
      refresh();
      setEditing(null);
      toast({ title: variables.id ? "Room updated" : "Room added", description: `${roomType.name} is saved with its meal plans.` });
    },
    onError: (error: Error) => toast({ title: "Could not save the room", description: errorText(error), variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async (roomType: StayRoomType) => {
      const response = await apiRequest("PATCH", `/api/admin/stays/${stayId}/room-types/${roomType.id}`, { isActive: !roomType.isActive });
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
      await apiRequest("DELETE", `/api/admin/stays/${stayId}/room-types/${roomType.id}`);
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
  const draftProblem = checkDraft(draft);
  const setRate = (code: MealPlanCode, next: Partial<RateDraft>) =>
    setDraft((current) => ({ ...current, rates: { ...current.rates, [code]: { ...current.rates[code], ...next } } }));

  return (
    <Card data-testid="hotel-rooms-editor">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle>Rooms &amp; rates</CardTitle>
          <CardDescription>
            Each room type, how many of its rooms the hotel sells through us, and its price per room per night on each meal plan.
            The hotel's price, guests and rooms on the site follow from these.
          </CardDescription>
        </div>
        <Button type="button" onClick={() => openEditor("new")} className="shrink-0" data-testid="button-add-room">
          <Plus className="mr-2 h-4 w-4" />
          Add room type
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading rooms…</p> : null}
        {!isLoading && roomTypes.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No rooms yet. Guests see this hotel once it has at least one room type with a price.
          </div>
        ) : null}
        {roomTypes.map((roomType) => (
          <div key={roomType.id} className="rounded-xl border p-4" data-testid={`admin-room-${roomType.id}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{roomType.name}</span>
                  <Badge variant={roomType.isActive ? "secondary" : "outline"}>{roomType.isActive ? "On sale" : "Not on sale"}</Badge>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5 shrink-0" />Sleeps {roomType.maxGuests}</span>
                  <span className="inline-flex items-center gap-1"><BedDouble className="h-3.5 w-3.5 shrink-0" />{roomType.roomCount} room{roomType.roomCount === 1 ? "" : "s"}{roomType.bedType ? ` · ${roomType.bedType}` : ""}</span>
                  {roomType.sizeSqm ? <span className="inline-flex items-center gap-1"><Maximize2 className="h-3.5 w-3.5 shrink-0" />{roomType.sizeSqm} m²</span> : null}
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {sortRoomRates(roomType.rates).map((rate) => (
                    <span key={rate.mealPlan} className="rounded-full border bg-muted/40 px-2.5 py-1 text-xs">
                      <span className="font-semibold">{rate.mealPlan}</span> {usd(rate.price)}
                      {rate.singlePrice ? <span className="text-muted-foreground"> · 1 guest {usd(rate.singlePrice)}</span> : null}
                    </span>
                  ))}
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
        ))}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="max-h-[95vh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto sm:w-full">
          <DialogHeader>
            <DialogTitle>{editing === "new" || editing === null ? "Add a room type" : `Edit ${editing.name}`}</DialogTitle>
            <DialogDescription>
              Prices are per room, per night, in whole US dollars, for up to the guests the room sleeps.
              If the hotel quotes per person sharing, multiply by the guests in the room.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="room-name">Room type</Label>
                <Input id="room-name" placeholder="Deluxe Double, Sea View" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="room-sleeps">Sleeps (guests per room)</Label>
                <Input id="room-sleeps" type="number" min="1" inputMode="numeric" value={draft.maxGuests} onChange={(event) => setDraft({ ...draft, maxGuests: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="room-count">Rooms of this type</Label>
                <Input id="room-count" type="number" min="1" inputMode="numeric" value={draft.roomCount} onChange={(event) => setDraft({ ...draft, roomCount: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="room-beds">Beds</Label>
                <Input id="room-beds" placeholder="1 king bed" value={draft.bedType} onChange={(event) => setDraft({ ...draft, bedType: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="room-size">Size in m² (optional)</Label>
                <Input id="room-size" type="number" min="1" inputMode="numeric" value={draft.sizeSqm} onChange={(event) => setDraft({ ...draft, sizeSqm: event.target.value })} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Meal plans and prices</Label>
              <div className="divide-y rounded-xl border">
                {mealPlanCodes.map((code) => {
                  const rate = draft.rates[code];
                  return (
                    <div key={code} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center" data-testid={`room-rate-${code}`}>
                      <label className="flex min-w-0 items-start gap-2">
                        <Checkbox
                          checked={rate.offered}
                          onCheckedChange={(checked) => setRate(code, { offered: checked === true })}
                          aria-label={`Offer ${mealPlans[code].name}`}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{mealPlans[code].name} ({code})</span>
                          <span className="block text-xs text-muted-foreground">{mealPlans[code].includes}</span>
                        </span>
                      </label>
                      <Input
                        type="number"
                        min="1"
                        inputMode="numeric"
                        placeholder="Room / night (US$)"
                        aria-label={`${mealPlans[code].name} price per room per night`}
                        disabled={!rate.offered}
                        value={rate.price}
                        onChange={(event) => setRate(code, { price: event.target.value })}
                      />
                      <Input
                        type="number"
                        min="1"
                        inputMode="numeric"
                        placeholder="One guest (optional)"
                        aria-label={`${mealPlans[code].name} price for one guest`}
                        disabled={!rate.offered}
                        value={rate.singlePrice}
                        onChange={(event) => setRate(code, { singlePrice: event.target.value })}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="room-description">Description (optional)</Label>
                <Textarea id="room-description" rows={2} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="room-amenities">Room amenities (comma separated)</Label>
                <Input id="room-amenities" placeholder="Air conditioning, Balcony, Sea view" value={draft.amenities} onChange={(event) => setDraft({ ...draft, amenities: event.target.value })} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Room photo (optional)</Label>
                <AdminMediaField
                  value={draft.imageUrl}
                  galleryUrls={draft.imageUrl ? [draft.imageUrl] : []}
                  mediaType="image"
                  onChange={({ mediaUrl, mediaType }) => {
                    if (mediaType === "video") {
                      toast({ title: "Use a photo", description: "A room's picture is a photo.", variant: "destructive" });
                      return;
                    }
                    setDraft((current) => ({ ...current, imageUrl: mediaUrl }));
                  }}
                />
              </div>
            </div>

            <label className="flex items-center justify-between gap-4 rounded-xl border p-3">
              <span>
                <span className="block text-sm font-medium">On sale</span>
                <span className="block text-xs text-muted-foreground">Turn off to stop guests booking this room. Bookings already made keep it.</span>
              </span>
              <Switch checked={draft.isActive} onCheckedChange={(checked) => setDraft({ ...draft, isActive: checked })} aria-label="On sale" />
            </label>

            {draftProblem ? <p className="text-sm text-muted-foreground" data-testid="room-form-hint">{draftProblem}</p> : null}
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              type="button"
              disabled={Boolean(draftProblem) || saveMutation.isPending}
              onClick={() => saveMutation.mutate({ id: editing && editing !== "new" ? editing.id : null, payload: toPayload(draft) })}
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
