import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ProviderLayout } from "@/components/provider-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/lib/currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { AdminMediaField } from "@/components/admin-media-field";
import type { Stay } from "@shared/schema";
import { isHotelStay } from "@shared/hotel-rooms";
import { ListingShareSheet } from "@/components/listing-share-sheet";
import { getListingSharePrice } from "@shared/listing-share";
import { Field } from "@/components/provider-hub/field";
import { HubPageHeader } from "@/components/provider-hub/hub-ui";
import { addCalendarDays, formatCalendarDate, formatCalendarDateRange } from "@shared/calendar-dates";

const dayLabel = (value: string | null | undefined) => (value ? formatCalendarDate(value, { day: "numeric", month: "short", year: "numeric" }, "en-GB") : "");

type StayAvailability = {
  blockedRanges: Array<{
    id: string;
    source: "booking" | "manual";
    startDate: string;
    endDate: string;
    checkoutDate: string;
    status: string;
    guestName: string;
    // At a hotel: the rooms held (no room type: the whole hotel).
    roomTypeName?: string | null;
    rooms?: number | null;
  }>;
  availableFrom: string;
  propertyType?: "hotel" | "entire_place";
};

export default function ProviderStayAvailability() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { usdToKes } = useCurrency();
  const { isLoading: authLoading, isProvider, isAdmin } = useAuth();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [title, setTitle] = useState("");
  const [locationValue, setLocationValue] = useState("");
  const [price, setPrice] = useState("");
  const [maxOccupancy, setMaxOccupancy] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!authLoading && !isProvider && !isAdmin) {
      setLocation("/auth?next=/provider/dashboard");
    }
  }, [authLoading, isProvider, isAdmin, setLocation]);

  const { data: stay } = useQuery<Stay>({
    queryKey: ["/api/provider/stays", id],
    enabled: !!id,
  });
  // A hotel's prices are per room and meal plan, set up by the team.
  const isHotel = isHotelStay(stay);

  useEffect(() => {
    if (stay) {
      setTitle(stay.title);
      setLocationValue(stay.location);
      setPrice(String(Math.round(stay.price * usdToKes)));
      setMaxOccupancy(String(stay.maxOccupancy));
      setBedrooms(String(stay.bedrooms));
      setBathrooms(String(stay.bathrooms));
      setImageUrl(stay.imageUrl ?? "");
      setGalleryUrls(stay.galleryUrls ?? []);
      setMediaType((stay.mediaType as "image" | "video") ?? "image");
      setDescription(stay.description);
    }
  }, [stay, usdToKes]);

  const { data: availability } = useQuery<StayAvailability>({
    queryKey: ["/api/provider/stays", id, "availability"],
    enabled: !!id,
    queryFn: async () => {
      const response = await fetch(`/api/provider/stays/${id}/availability`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load availability");
      return response.json();
    },
  });

  const createBlockMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/provider/stays/${id}/availability/blocks`, { startDate, endDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/stays", id, "availability"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stays", id, "availability"] });
      setStartDate("");
      setEndDate("");
      toast({ title: "Dates blocked", description: "Availability updated successfully." });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not block dates",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const deleteBlockMutation = useMutation({
    mutationFn: async (blockId: string) => apiRequest("DELETE", `/api/provider/stays/${id}/availability/blocks/${blockId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/stays", id, "availability"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stays", id, "availability"] });
      toast({ title: "Block removed", description: "Availability updated successfully." });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not remove block",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const updateStayMutation = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/provider/stays/${id}`, {
      title,
      location: locationValue,
      price: Math.max(1, Math.round(Number(price) / usdToKes)),
      maxOccupancy: Number(maxOccupancy),
      bedrooms: Number(bedrooms),
      bathrooms: Number(bathrooms),
      imageUrl,
      galleryUrls,
      mediaType,
      description,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/stays", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/provider/assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stays", id] });
      toast({
        title: "Listing updated",
        description: "Your changes are live. TBM reviews your edits afterwards.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not update listing",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  return (
    <ProviderLayout title={stay?.title ?? "Stay"}>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <HubPageHeader
          eyebrow="Stays"
          title={stay?.title ?? "Your stay"}
          description={availability?.availableFrom ? `Next free night: ${dayLabel(availability.availableFrom)}` : "Loading dates…"}
          actions={stay ? (
            <ListingShareSheet kind="stay" id={stay.id} name={stay.title} description={stay.description} {...getListingSharePrice("stay", stay)} isPublic={stay.isPublic} source="provider" size="default" triggerLabel="Share listing" />
          ) : undefined}
        />

        <Card id="details" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Listing details</CardTitle>
            <CardDescription>
              Changes go live when you save. TBM reviews your edits afterwards.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{isHotel ? "Rooms from (per night)" : "Nightly rate"}</div>
                <div className="mt-2 text-2xl font-semibold text-foreground">
                  {price && Number(price) > 0 ? `KSh ${Number(price).toLocaleString()}` : "Not set"}
                </div>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Guest capacity</div>
                <div className="mt-2 text-2xl font-semibold text-foreground">
                  {maxOccupancy || "0"}
                </div>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Photo count</div>
                <div className="mt-2 text-2xl font-semibold text-foreground">
                  {imageUrl ? Math.max(1, galleryUrls.length) : 0}
                </div>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field id="stay-title" label="Name guests see">
                <Input id="stay-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example, Beachfront villa with pool" />
              </Field>
              <Field id="stay-location" label="Area">
                <Input id="stay-location" value={locationValue} onChange={(e) => setLocationValue(e.target.value)} placeholder="For example, Galu Beach, Diani" />
              </Field>
              {isHotel ? null : (
                <>
                  <Field id="stay-guests" label="Most guests">
                    <Input id="stay-guests" type="number" inputMode="numeric" min="1" value={maxOccupancy} onChange={(e) => setMaxOccupancy(e.target.value)} />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field id="stay-bedrooms" label="Bedrooms">
                      <Input id="stay-bedrooms" type="number" inputMode="numeric" min="0" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} />
                    </Field>
                    <Field id="stay-bathrooms" label="Bathrooms">
                      <Input id="stay-bathrooms" type="number" inputMode="numeric" min="0" value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} />
                    </Field>
                  </div>
                </>
              )}
            </div>
            {isHotel ? (
              <div id="pricing" className="scroll-mt-24 rounded-xl border border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
                <div className="mb-1 text-base font-medium text-foreground">Rooms and meal plans</div>
                This is a hotel: its rooms, meal plans and prices per room per night are set up by the Tembea Bila Matata team.
                Message the team to change them.
              </div>
            ) : (
            <div id="pricing" className="scroll-mt-24 rounded-xl border border-border/70 bg-muted/20 p-5">
              <div className="mb-4">
                <div className="text-base font-medium text-foreground">Pricing</div>
                <p className="text-sm text-muted-foreground">
                  Update the guest-facing nightly rate in Kenya shillings. We keep the existing stay details below unchanged unless you edit them.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                <Field id="stay-price" label="Price a night (KSh)" hint="What guests pay a night, before any add-ons.">
                  <Input id="stay-price" type="number" inputMode="numeric" min="1" value={price} onChange={(e) => setPrice(e.target.value)} />
                </Field>
                <div className="rounded-xl border border-border/70 bg-background p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Current setup</div>
                  <div className="mt-2 text-lg font-semibold text-foreground">
                    {price ? `KSh ${Number(price).toLocaleString()} / night` : "Add nightly rate"}
                  </div>
                </div>
              </div>
            </div>
            )}
            <div id="media" className="scroll-mt-24 space-y-3 rounded-xl border border-border/70 bg-muted/20 p-5">
              <div>
                <div className="text-base font-medium text-foreground">Photos</div>
                <p className="text-sm text-muted-foreground">
                  Review the current cover image, upload fresh photos, and reorder the gallery so guests see the strongest first impression.
                </p>
              </div>
              <AdminMediaField
                value={imageUrl}
                galleryUrls={galleryUrls}
                mediaType={mediaType}
                onChange={({ mediaUrl, mediaType: nextMediaType, galleryUrls: nextGalleryUrls }) => {
                  setImageUrl(mediaUrl);
                  setGalleryUrls(nextGalleryUrls);
                  setMediaType(nextMediaType);
                }}
                onMediaTypeChange={(value: "image" | "video") => setMediaType(value)}
              />
            </div>
            <Field id="stay-description" label="Description" hint="What makes it special, who it suits, and what's nearby.">
              <Textarea id="stay-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={5} />
            </Field>
            <Button onClick={() => updateStayMutation.mutate()} disabled={updateStayMutation.isPending}>
              {updateStayMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </CardContent>
        </Card>

        <Card id="availability" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Dates you're away</CardTitle>
            <CardDescription>Block nights when the house isn't available: you're using it, it's being repaired, or it's booked elsewhere. Guests can't book them.</CardDescription>
          </CardHeader>
          <CardContent className="grid items-end gap-3 md:grid-cols-3">
            <Field id="block-start" label="First night unavailable">
              <Input id="block-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field id="block-end" label="Free again from">
              <Input id="block-end" type="date" min={startDate ? addCalendarDays(startDate, 1) : undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
            <Button onClick={() => createBlockMutation.mutate()} disabled={createBlockMutation.isPending || !startDate || !endDate}>
              {createBlockMutation.isPending ? "Blocking..." : "Block these nights"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Booked and blocked nights</CardTitle>
            <CardDescription>Guest bookings show here too. Only TBM can change those.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {availability?.blockedRanges?.length ? availability.blockedRanges.map((range) => (
              <div key={range.id} className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <div className="font-medium">Nights of {formatCalendarDateRange(range.startDate, range.endDate, "en-GB")}</div>
                  <div className="text-sm text-muted-foreground">
                    {range.source === "manual"
                      ? `Blocked by you · free again ${dayLabel(range.checkoutDate)}`
                      : `${range.guestName} · checks out ${dayLabel(range.checkoutDate)}`}
                  </div>
                  {availability?.propertyType === "hotel" ? (
                    <div className="text-xs text-muted-foreground">
                      {range.roomTypeName ? `${range.rooms ? `${range.rooms} × ` : "All "}${range.roomTypeName}` : "The whole hotel"}
                    </div>
                  ) : null}
                </div>
                {range.source === "manual" ? (
                  <Button variant="outline" size="sm" onClick={() => deleteBlockMutation.mutate(range.id)} disabled={deleteBlockMutation.isPending}>
                    Remove
                  </Button>
                ) : (
                  <div className="text-sm text-muted-foreground">{range.status === "confirmed" ? "Booked" : range.status === "pending" ? "Being booked" : range.status.charAt(0).toUpperCase() + range.status.slice(1)}</div>
                )}
              </div>
            )) : <p className="text-sm text-muted-foreground">No blocked dates yet.</p>}
          </CardContent>
        </Card>
      </div>
    </ProviderLayout>
  );
}
