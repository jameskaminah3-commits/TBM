import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";
import { ProviderLayout } from "@/components/provider-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { AdminMediaField } from "@/components/admin-media-field";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/lib/currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertStaySchema, type Stay } from "@shared/schema";
import { hotelFeatureOptions } from "@/components/provider-hotel-manage";
import { BedDouble, Home } from "lucide-react";

const featureOptions = [
  "WiFi",
  "Hot Shower",
  "Parking",
  "Kitchen",
  "Smart TV",
  "Air Conditioning",
  "Pool",
  "Gym",
  "Ocean View",
  "Mountain View",
  "Pet Friendly",
  "Wheelchair Accessible",
];

const formSchema = insertStaySchema.extend({
  price: z.coerce.number().min(1, "Price must be at least $1"),
  maxOccupancy: z.coerce.number().min(1, "At least 1 guest required"),
  bedrooms: z.coerce.number().min(1, "At least 1 bedroom required"),
  bathrooms: z.coerce.number().min(1, "At least 1 bathroom required"),
});

// A hotel's price, guests and rooms come from the room types added next.
const hotelFormSchema = insertStaySchema.extend({
  price: z.coerce.number().optional(),
  maxOccupancy: z.coerce.number().optional(),
  bedrooms: z.coerce.number().optional(),
  bathrooms: z.coerce.number().optional(),
});

type FormData = z.infer<typeof formSchema>;
type StayKind = "entire_place" | "hotel";

const stayKinds: Array<{ kind: StayKind; icon: typeof Home; name: string; what: string }> = [
  { kind: "entire_place", icon: Home, name: "An entire place", what: "An apartment, villa or home. One booking takes the whole place, at one price a night." },
  { kind: "hotel", icon: BedDouble, name: "A hotel", what: "A hotel, lodge, resort or guest house. Guests book rooms by type, with meal plans and rates for singles, couples and children." },
];

export default function ProviderStayNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { usdToKes } = useCurrency();
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [kind, setKind] = useState<StayKind>("entire_place");
  const [starRating, setStarRating] = useState("");
  const isHotel = kind === "hotel";

  const form = useForm<FormData>({
    resolver: (isHotel ? zodResolver(hotelFormSchema) : zodResolver(formSchema)) as Resolver<FormData>,
    defaultValues: {
      title: "",
      price: 0,
      location: "",
      maxOccupancy: 2,
      bedrooms: 1,
      bathrooms: 1,
      imageUrl: "",
      galleryUrls: [],
      mediaType: "image",
      isPublic: false,
      description: "",
      features: [],
    },
  });

  const createStayMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const response = await apiRequest("POST", "/api/provider/stays", data);
      return response.json() as Promise<Stay>;
    },
    onSuccess: (stay) => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/assignments"] });
      if (stay.propertyType === "hotel") {
        toast({
          title: "Hotel created",
          description: "Now add your rooms and rates. The hotel stays private until TBM reviews and publishes it.",
        });
        setLocation(`/provider/stays/${stay.id}/availability#rooms`);
        return;
      }
      toast({
        title: "Listing created",
        description: "Your stay was created as private and is waiting for admin review before going public.",
      });
      setLocation("/provider/dashboard");
    },
    onError: (error: Error) => {
      toast({
        title: "Could not create listing",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const handleFeatureToggle = (feature: string) => {
    const updated = selectedFeatures.includes(feature)
      ? selectedFeatures.filter((item) => item !== feature)
      : [...selectedFeatures, feature];
    setSelectedFeatures(updated);
    form.setValue("features", updated);
  };

  const onSubmit = async (data: FormData) => {
    await createStayMutation.mutateAsync(isHotel
      ? {
          ...data,
          propertyType: "hotel",
          starRating: starRating ? Number(starRating) : null,
          checkInTime: data.checkInTime || null,
          checkOutTime: data.checkOutTime || null,
          isPublic: false,
          features: selectedFeatures,
        }
      : {
          ...data,
          propertyType: "entire_place",
          checkInTime: null,
          checkOutTime: null,
          price: Math.max(1, Math.round(data.price / usdToKes)),
          isPublic: false,
          features: selectedFeatures,
        });
  };

  const chooseKind = (next: StayKind) => {
    setKind(next);
    const allowed = next === "hotel" ? hotelFeatureOptions : featureOptions;
    const kept = selectedFeatures.filter((feature) => allowed.includes(feature));
    setSelectedFeatures(kept);
    form.setValue("features", kept);
    form.clearErrors();
  };

  return (
    <ProviderLayout>
      <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-semibold mb-2">Add Stay Listing</h1>
          <p className="text-muted-foreground">
            Create your stay listing. It will remain private until an admin reviews and publishes it.
          </p>
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="What are you listing?">
          {stayKinds.map((option) => {
            const selected = kind === option.kind;
            return (
              <button
                key={option.kind}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => chooseKind(option.kind)}
                className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "bg-background hover:border-foreground/30"}`}
                data-testid={`stay-kind-${option.kind}`}
              >
                <option.icon className={`mt-0.5 h-5 w-5 shrink-0 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                <span>
                  <span className="block font-medium">{option.name}</span>
                  <span className="block text-sm text-muted-foreground">{option.what}</span>
                </span>
              </button>
            );
          })}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{isHotel ? "Hotel Details" : "Stay Details"}</CardTitle>
            <CardDescription>
              {isHotel
                ? "Start with the hotel itself. You add its rooms, meal plans and prices on the next page."
                : "Fill out the listing details and upload your property photos."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input placeholder={isHotel ? "Coral Cove Beach Hotel" : "Luxury Beach Villa"} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {isHotel ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <label htmlFor="new-hotel-stars" className="text-sm font-medium leading-none">Star rating</label>
                      <select
                        id="new-hotel-stars"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={starRating}
                        onChange={(event) => setStarRating(event.target.value)}
                      >
                        <option value="">Not rated</option>
                        {[1, 2, 3, 4, 5].map((stars) => <option key={stars} value={stars}>{stars} star{stars === 1 ? "" : "s"}</option>)}
                      </select>
                    </div>
                    <FormField
                      control={form.control}
                      name="checkInTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Check-in from</FormLabel>
                          <FormControl>
                            <Input type="time" {...field} value={field.value ?? ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="checkOutTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Check-out by</FormLabel>
                          <FormControl>
                            <Input type="time" {...field} value={field.value ?? ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                ) : (
                <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="price"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Price per Night</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" placeholder="19500" {...field} />
                        </FormControl>
                        <FormDescription>Enter the nightly price in KSh. We convert and store it in USD automatically.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="maxOccupancy"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Max Occupancy</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" placeholder="4" {...field} />
                        </FormControl>
                        <FormDescription>Maximum guests</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="bedrooms"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bedrooms</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" placeholder="3" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="bathrooms"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bathrooms</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" placeholder="2" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                </>
                )}

                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location</FormLabel>
                      <FormControl>
                        <Input placeholder="Diani Beach, Kenya" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="imageUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{isHotel ? "Hotel Photos" : "Property Media"}</FormLabel>
                      <FormControl>
                        <AdminMediaField
                          value={field.value}
                          galleryUrls={form.watch("galleryUrls")}
                          mediaType={form.watch("mediaType")}
                          onChange={({ mediaUrl, mediaType, galleryUrls }) => {
                            form.setValue("imageUrl", mediaUrl);
                            form.setValue("galleryUrls", galleryUrls);
                            form.setValue("mediaType", mediaType);
                          }}
                        />
                      </FormControl>
                      <FormDescription>
                        {isHotel
                          ? "The building, pool, restaurant and grounds. Each room gets its own photos on the next page."
                          : "Upload one or many property images. The app will optimize them before upload."}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea placeholder={isHotel ? "Describe the hotel..." : "Describe the stay..."} rows={5} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-4">
                  <FormLabel>Features & Amenities</FormLabel>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {(isHotel ? hotelFeatureOptions : featureOptions).map((feature) => (
                      <div key={feature} className="flex items-center space-x-2">
                        <Checkbox
                          checked={selectedFeatures.includes(feature)}
                          onCheckedChange={() => handleFeatureToggle(feature)}
                        />
                        <label className="text-sm">{feature}</label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-4 pt-4">
                  <Button type="button" variant="outline" onClick={() => setLocation("/provider/dashboard")}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createStayMutation.isPending}>
                    {createStayMutation.isPending ? "Creating..." : isHotel ? "Create hotel and add rooms" : "Create Listing"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </ProviderLayout>
  );
}
