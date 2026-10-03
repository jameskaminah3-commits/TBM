import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminMediaField } from "@/components/admin-media-field";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertStaySchema, type ProviderAccountSummary } from "@shared/schema";
import { stayPropertyTypes } from "@shared/hotel-rooms";
import { HotelDetailsFields, StayKindPicker, hotelFacilityOptions } from "@/components/admin-stay-kind-fields";

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

// A hotel's price, guests, bedrooms and bathrooms come from its rooms, added
// after it's created; an entire place needs them here.
const formSchema = insertStaySchema.extend({
  price: z.coerce.number().min(0),
  rating: z.coerce.number().min(1, "Rating must be at least 1").max(5, "Rating cannot exceed 5"),
  reviewCount: z.coerce.number().min(0, "Review count cannot be negative"),
  managerUserId: z.string().optional(),
  maxOccupancy: z.coerce.number().min(0),
  bedrooms: z.coerce.number().min(0),
  bathrooms: z.coerce.number().min(0),
  propertyType: z.enum(stayPropertyTypes),
  starRating: z.coerce.number().int().min(0).max(5),
  checkInTime: z.string(),
  checkOutTime: z.string(),
}).superRefine((data, ctx) => {
  if (data.propertyType === "hotel") return;
  if (data.price < 1) ctx.addIssue({ code: "custom", path: ["price"], message: "Price must be at least $1" });
  if (data.maxOccupancy < 1) ctx.addIssue({ code: "custom", path: ["maxOccupancy"], message: "At least 1 guest required" });
  if (data.bedrooms < 1) ctx.addIssue({ code: "custom", path: ["bedrooms"], message: "At least 1 bedroom required" });
  if (data.bathrooms < 1) ctx.addIssue({ code: "custom", path: ["bathrooms"], message: "At least 1 bathroom required" });
});

type FormData = z.infer<typeof formSchema>;

export default function AdminStaysNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const { data: providers = [] } = useQuery<ProviderAccountSummary[]>({
    queryKey: ["/api/admin/provider-accounts"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      price: 0,
      rating: 5,
      reviewCount: 0,
      managerUserId: "unassigned",
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
      propertyType: "entire_place",
      starRating: 0,
      checkInTime: "",
      checkOutTime: "",
    },
  });
  const propertyType = form.watch("propertyType");
  const isHotel = propertyType === "hotel";

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const response = await apiRequest("POST", "/api/admin/stays", data);
      return response.json() as Promise<{ id: string; propertyType?: string }>;
    },
    onSuccess: (stay) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stays"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stays"] });
      if (stay.propertyType === "hotel") {
        // Next: the hotel's rooms and meal-plan rates.
        toast({
          title: "Hotel created",
          description: "Now add its rooms and their meal-plan prices. Guests see the hotel once it has a room with a price.",
        });
        setLocation(`/admin/stays/${stay.id}/edit#rooms`);
        return;
      }
      toast({
        title: "Success",
        description: "Stay created successfully",
      });
      setLocation("/admin/listings");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create stay",
        variant: "destructive",
      });
    },
  });

  const handleFeatureToggle = (feature: string) => {
    const updated = selectedFeatures.includes(feature)
      ? selectedFeatures.filter((f) => f !== feature)
      : [...selectedFeatures, feature];
    setSelectedFeatures(updated);
    form.setValue("features", updated);
  };

  const onSubmit = async (data: FormData) => {
    const hotel = data.propertyType === "hotel";
    await createMutation.mutateAsync({
      ...data,
      managerUserId: data.managerUserId === "unassigned" ? undefined : data.managerUserId,
      features: selectedFeatures,
      starRating: hotel && data.starRating ? data.starRating : null,
      checkInTime: data.checkInTime || null,
      checkOutTime: data.checkOutTime || null,
    });
  };

  return (
    <AdminLayout>
      <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-semibold mb-2">Add New Stay</h1>
          <p className="text-muted-foreground">
            Create a new accommodation listing
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Stay Details</CardTitle>
            <CardDescription>
              Fill out all required fields to create a new stay
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <StayKindPicker
                  value={propertyType}
                  onChange={(value) => form.setValue("propertyType", value, { shouldDirty: true })}
                />

                {isHotel ? (
                  <HotelDetailsFields
                    starRating={form.watch("starRating")}
                    checkInTime={form.watch("checkInTime")}
                    checkOutTime={form.watch("checkOutTime")}
                    onChange={(next) => {
                      if (next.starRating !== undefined) form.setValue("starRating", next.starRating);
                      if (next.checkInTime !== undefined) form.setValue("checkInTime", next.checkInTime);
                      if (next.checkOutTime !== undefined) form.setValue("checkOutTime", next.checkOutTime);
                    }}
                  />
                ) : null}

                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input placeholder="Luxury Beach Villa" {...field} data-testid="input-stay-title" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="rating"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Rating</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" max="5" step="0.1" placeholder="4.8" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="reviewCount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Review Count</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" placeholder="24" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {isHotel ? (
                  <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                    A hotel's price, rooms and guests come from its room types and their meal-plan prices,
                    which you add once the hotel is created.
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
                          <Input
                            type="number"
                            min="1"
                            placeholder="150"
                            {...field}
                            data-testid="input-stay-price"
                          />
                        </FormControl>
                        <FormDescription>USD per night</FormDescription>
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
                          <Input
                            type="number"
                            min="1"
                            placeholder="4"
                            {...field}
                            data-testid="input-stay-max-occupancy"
                          />
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
                          <Input
                            type="number"
                            min="1"
                            placeholder="3"
                            {...field}
                            data-testid="input-stay-bedrooms"
                          />
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
                          <Input
                            type="number"
                            min="1"
                            placeholder="2"
                            {...field}
                            data-testid="input-stay-bathrooms"
                          />
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
                  name="managerUserId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assigned Provider</FormLabel>
                      <Select value={field.value ?? "unassigned"} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Assign a provider" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {providers.map((provider) => (
                            <SelectItem key={provider.id} value={provider.id}>
                              {[provider.firstName, provider.lastName].filter(Boolean).join(" ") || provider.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Only the assigned provider will see this stay in their partner dashboard.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location</FormLabel>
                      <FormControl>
                        <Input placeholder="Diani Beach, Kenya" {...field} data-testid="input-stay-location" />
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
                      <FormLabel>Media</FormLabel>
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
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="isPublic"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-1">
                        <FormLabel>Public Listing</FormLabel>
                        <FormDescription>Turn this on when the stay should appear on the live site.</FormDescription>
                      </div>
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
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
                        <Textarea
                          placeholder="Describe the stay..."
                          rows={4}
                          {...field}
                          data-testid="input-stay-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-4">
                  <FormLabel>{isHotel ? "Hotel facilities" : "Features & Amenities"}</FormLabel>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {(isHotel ? hotelFacilityOptions : featureOptions).map((feature) => (
                      <div key={feature} className="flex items-center space-x-2">
                        <Checkbox
                          checked={selectedFeatures.includes(feature)}
                          onCheckedChange={() => handleFeatureToggle(feature)}
                          data-testid={`checkbox-feature-${feature.toLowerCase().replace(/\s/g, "-")}`}
                        />
                        <label className="text-sm">{feature}</label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-4 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setLocation("/admin/listings")}
                    data-testid="button-cancel-stay"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending}
                    data-testid="button-submit-stay"
                  >
                    {createMutation.isPending ? "Creating..." : isHotel ? "Create hotel, then add rooms" : "Create Stay"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
