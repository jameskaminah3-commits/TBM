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
import { CarZonePricingEditor } from "@/components/car-zone-pricing-editor";
import type { Car, CarZoneRate } from "@shared/schema";

type CarAvailability = {
  blockedRanges: Array<{
    id: string;
    source: "booking" | "manual";
    startDate: string;
    endDate: string;
    checkoutDate: string;
    status: string;
    guestName: string;
    serviceMode?: string;
  }>;
  availableFrom: string;
};

export default function ProviderCarAvailability() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { usdToKes } = useCurrency();
  const { isLoading: authLoading, isProvider, isAdmin } = useAuth();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [model, setModel] = useState("");
  const [locationValue, setLocationValue] = useState("");
  const [pricePerDay, setPricePerDay] = useState("");
  const [priceWithDriver, setPriceWithDriver] = useState("");
  const [priceWithDriverHourly, setPriceWithDriverHourly] = useState("");
  const [selfDriveMileageLimitKm, setSelfDriveMileageLimitKm] = useState("");
  const [selfDriveExtraKmRate, setSelfDriveExtraKmRate] = useState("");
  const [chauffeurZones, setChauffeurZones] = useState<CarZoneRate[]>([]);
  const [seats, setSeats] = useState("");
  const [transmission, setTransmission] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [mediaType, setMediaType] = useState<"image" | "video">("image");

  useEffect(() => {
    if (!authLoading && !isProvider && !isAdmin) {
      setLocation("/auth?next=/provider/dashboard");
    }
  }, [authLoading, isProvider, isAdmin, setLocation]);

  const { data: car } = useQuery<Car>({
    queryKey: ["/api/provider/cars", id],
    enabled: !!id,
  });

  useEffect(() => {
    if (car) {
      setModel(car.model);
      setLocationValue(car.location);
      setPricePerDay(car.pricePerDay ? String(Math.round(car.pricePerDay * usdToKes)) : "");
      setPriceWithDriver(String(Math.round(car.priceWithDriver * usdToKes)));
      setPriceWithDriverHourly(car.priceWithDriverHourly ? String(Math.round(car.priceWithDriverHourly * usdToKes)) : "");
      setSelfDriveMileageLimitKm(car.selfDriveMileageLimitKm ? String(car.selfDriveMileageLimitKm) : "");
      setSelfDriveExtraKmRate(car.selfDriveExtraKmRate ? String(Math.round(car.selfDriveExtraKmRate * usdToKes)) : "");
      setChauffeurZones(car.chauffeurZones ?? []);
      setSeats(String(car.seats));
      setTransmission(car.transmission);
      setDescription(car.description);
      setImageUrl(car.imageUrl ?? "");
      setGalleryUrls(car.galleryUrls ?? []);
      setMediaType(car.mediaType as "image" | "video");
    }
  }, [car, usdToKes]);

  const { data: availability } = useQuery<CarAvailability>({
    queryKey: ["/api/provider/cars", id, "availability"],
    enabled: !!id,
    queryFn: async () => {
      const response = await fetch(`/api/provider/cars/${id}/availability`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load availability");
      return response.json();
    },
  });

  const createBlockMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/provider/cars/${id}/availability/blocks`, { startDate, endDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/cars", id, "availability"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cars", id, "availability"] });
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
    mutationFn: async (blockId: string) => apiRequest("DELETE", `/api/provider/cars/${id}/availability/blocks/${blockId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/cars", id, "availability"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cars", id, "availability"] });
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

  const updateCarMutation = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/provider/cars/${id}`, {
      model,
      location: locationValue,
      pricePerDay: pricePerDay ? Math.max(1, Math.round(Number(pricePerDay) / usdToKes)) : undefined,
      priceWithDriver: Math.max(1, Math.round(Number(priceWithDriver) / usdToKes)),
      priceWithDriverHourly: priceWithDriverHourly ? Math.max(1, Math.round(Number(priceWithDriverHourly) / usdToKes)) : undefined,
      selfDriveMileageLimitKm: selfDriveMileageLimitKm ? Number(selfDriveMileageLimitKm) : undefined,
      selfDriveExtraKmRate: selfDriveExtraKmRate ? Math.max(1, Math.round(Number(selfDriveExtraKmRate) / usdToKes)) : undefined,
      chauffeurZones,
      seats: Number(seats),
      transmission,
      description,
      imageUrl,
      galleryUrls,
      mediaType,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/cars", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/provider/assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cars"] });
      toast({
        title: "Listing updated",
        description: "Your changes were saved and the listing is private until admin review.",
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
          <h1 className="text-3xl font-semibold tracking-tight">{car?.model ?? "Car Listing"}</h1>
          <p className="text-muted-foreground mt-1">
            Next available date: {availability?.availableFrom ?? "Loading..."}
          </p>
        </div>

        <Card id="details" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Listing Details</CardTitle>
            <CardDescription>
              Saving changes sends the listing back to private so admin can review and publish it again.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Chauffeur day rate</div>
                <div className="mt-2 text-2xl font-semibold text-foreground">
                  {priceWithDriver ? `KSh ${Number(priceWithDriver).toLocaleString()}` : "Not set"}
                </div>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Self-drive day rate</div>
                <div className="mt-2 text-2xl font-semibold text-foreground">
                  {pricePerDay ? `KSh ${Number(pricePerDay).toLocaleString()}` : "Optional"}
                </div>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Gallery</div>
                <div className="mt-2 text-2xl font-semibold text-foreground">
                  {imageUrl ? Math.max(1, galleryUrls.length) : 0}
                </div>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Car model" />
              <Input value={locationValue} onChange={(e) => setLocationValue(e.target.value)} placeholder="Location" />
              <Input type="number" value={seats} onChange={(e) => setSeats(e.target.value)} placeholder="Seats" />
              <Input value={transmission} onChange={(e) => setTransmission(e.target.value)} placeholder="Transmission" />
            </div>
            <div id="pricing" className="scroll-mt-24 space-y-4 rounded-xl border border-border/70 bg-muted/20 p-5">
              <div>
                <div className="text-base font-medium text-foreground">Pricing</div>
                <p className="text-sm text-muted-foreground">
                  Keep your standard rates current, then add polished zone pricing for airport runs, local transfers, and full-day routes.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Input type="number" value={priceWithDriver} onChange={(e) => setPriceWithDriver(e.target.value)} placeholder="Chauffeur per day (KSh)" />
                <Input type="number" value={pricePerDay} onChange={(e) => setPricePerDay(e.target.value)} placeholder="Self-drive per day (KSh, optional)" />
                <Input type="number" value={priceWithDriverHourly} onChange={(e) => setPriceWithDriverHourly(e.target.value)} placeholder="Chauffeur per hour (KSh, optional)" />
                <Input type="number" value={selfDriveMileageLimitKm} onChange={(e) => setSelfDriveMileageLimitKm(e.target.value)} placeholder="Included km per day (optional)" />
                <Input type="number" value={selfDriveExtraKmRate} onChange={(e) => setSelfDriveExtraKmRate(e.target.value)} placeholder="Extra km rate (KSh, optional)" />
              </div>
              <CarZonePricingEditor value={chauffeurZones} onChange={setChauffeurZones} currency="KES" usdToKes={usdToKes} />
            </div>
            <div id="media" className="scroll-mt-24 space-y-3 rounded-xl border border-border/70 bg-muted/20 p-5">
              <div>
                <div className="text-base font-medium text-foreground">Photos</div>
                <p className="text-sm text-muted-foreground">
                  Choose a strong cover shot, keep the gallery current, and remove images that no longer represent the vehicle.
                </p>
              </div>
              <AdminMediaField
                value={imageUrl}
                galleryUrls={galleryUrls}
                mediaType={mediaType}
                onChange={(payload) => {
                  setGalleryUrls(payload.galleryUrls);
                  setImageUrl(payload.mediaUrl);
                }}
                onMediaTypeChange={(value: "image" | "video") => setMediaType(value)}
              />
            </div>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} placeholder="Description" />
            <Button onClick={() => updateCarMutation.mutate()} disabled={updateCarMutation.isPending}>
              {updateCarMutation.isPending ? "Saving..." : "Save Listing Changes"}
            </Button>
          </CardContent>
        </Card>

        <Card id="availability" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Block Dates</CardTitle>
            <CardDescription>Use this when the car is unavailable for maintenance, owner use, or held inventory.</CardDescription>
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
            <CardDescription>Customer bookings appear here. Manual blocks can be removed from this screen.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {availability?.blockedRanges?.length ? availability.blockedRanges.map((range) => (
              <div key={range.id} className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <div className="font-medium">{range.startDate} to {range.endDate}</div>
                  <div className="text-sm text-muted-foreground">
                    {range.source === "manual"
                      ? "Manual provider block"
                      : `${range.guestName}${range.serviceMode ? ` • ${range.serviceMode}` : ""}`}
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
