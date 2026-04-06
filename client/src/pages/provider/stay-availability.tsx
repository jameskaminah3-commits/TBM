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

type StayAvailability = {
  blockedRanges: Array<{
    id: string;
    source: "booking" | "manual";
    startDate: string;
    endDate: string;
    checkoutDate: string;
    status: string;
    guestName: string;
  }>;
  availableFrom: string;
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
        description: "Your changes were saved and the listing is now private until an admin reviews it.",
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
    <ProviderLayout>
      <div className="container mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{stay?.title ?? "Stay Availability"}</h1>
          <p className="text-muted-foreground mt-1">
            Next available date: {availability?.availableFrom ?? "Loading..."}
          </p>
        </div>

        <Card id="details" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Listing Details</CardTitle>
            <CardDescription>
              Saving changes sends the listing back to private so an admin can review and publish it again.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Nightly rate</div>
                <div className="mt-2 text-2xl font-semibold text-foreground">
                  {price ? `KSh ${Number(price).toLocaleString()}` : "Not set"}
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
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Stay title" />
              <Input value={locationValue} onChange={(e) => setLocationValue(e.target.value)} placeholder="Location" />
              <Input type="number" value={maxOccupancy} onChange={(e) => setMaxOccupancy(e.target.value)} placeholder="Max occupancy" />
              <Input type="number" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} placeholder="Bedrooms" />
              <Input type="number" value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} placeholder="Bathrooms" />
            </div>
            <div id="pricing" className="scroll-mt-24 rounded-xl border border-border/70 bg-muted/20 p-5">
              <div className="mb-4">
                <div className="text-base font-medium text-foreground">Pricing</div>
                <p className="text-sm text-muted-foreground">
                  Update the guest-facing nightly rate in Kenya shillings. We keep the existing stay details below unchanged unless you edit them.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price per night (KSh)" />
                <div className="rounded-xl border border-border/70 bg-background p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Current setup</div>
                  <div className="mt-2 text-lg font-semibold text-foreground">
                    {price ? `KSh ${Number(price).toLocaleString()} / night` : "Add nightly rate"}
                  </div>
                </div>
              </div>
            </div>
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
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} placeholder="Description" />
            <Button onClick={() => updateStayMutation.mutate()} disabled={updateStayMutation.isPending}>
              {updateStayMutation.isPending ? "Saving..." : "Save Listing Changes"}
            </Button>
          </CardContent>
        </Card>

        <Card id="availability" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Block Dates</CardTitle>
            <CardDescription>Use this when the house is unavailable for owner use, maintenance, or held inventory.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <Button onClick={() => createBlockMutation.mutate()} disabled={createBlockMutation.isPending}>
              {createBlockMutation.isPending ? "Blocking..." : "Block Dates"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Blocked and Booked Dates</CardTitle>
            <CardDescription>Customer bookings are visible here but cannot be removed from this screen.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {availability?.blockedRanges?.length ? availability.blockedRanges.map((range) => (
              <div key={range.id} className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <div className="font-medium">{range.startDate} to {range.endDate}</div>
                  <div className="text-sm text-muted-foreground">
                    {range.source === "manual"
                      ? "Manual provider block"
                      : `${range.guestName}${range.checkoutDate !== range.startDate ? `, checkout ${range.checkoutDate}` : ""}`}
                  </div>
                </div>
                {range.source === "manual" ? (
                  <Button variant="outline" size="sm" onClick={() => deleteBlockMutation.mutate(range.id)} disabled={deleteBlockMutation.isPending}>
                    Remove
                  </Button>
                ) : (
                  <div className="text-sm text-muted-foreground capitalize">{range.status}</div>
                )}
              </div>
            )) : <p className="text-sm text-muted-foreground">No blocked dates yet.</p>}
          </CardContent>
        </Card>
      </div>
    </ProviderLayout>
  );
}
