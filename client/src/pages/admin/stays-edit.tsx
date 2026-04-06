import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { insertStaySchema, type Stay, type ProviderAccountSummary } from "@shared/schema";

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
  rating: z.coerce.number().min(1, "Rating must be at least 1").max(5, "Rating cannot exceed 5"),
  reviewCount: z.coerce.number().min(0, "Review count cannot be negative"),
  managerUserId: z.string().optional(),
  maxOccupancy: z.coerce.number().min(1, "At least 1 guest required"),
  bedrooms: z.coerce.number().min(1, "At least 1 bedroom required"),
  bathrooms: z.coerce.number().min(1, "At least 1 bathroom required"),
});

type FormData = z.infer<typeof formSchema>;

export default function AdminStaysEdit() {
  const params = useParams();
  const stayId = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [blockStartDate, setBlockStartDate] = useState("");
  const [blockEndDate, setBlockEndDate] = useState("");
  const { data: providers = [] } = useQuery<ProviderAccountSummary[]>({
    queryKey: ["/api/admin/provider-accounts"],
  });

  const { data: stay, isLoading } = useQuery<Stay>({
    queryKey: ["/api/admin/stays", stayId],
    enabled: !!stayId,
  });

  const { data: availability } = useQuery<StayAvailability>({
    queryKey: ["/api/admin/stays", stayId, "availability"],
    enabled: !!stayId,
    queryFn: async () => {
      const response = await fetch(`/api/admin/stays/${stayId}/availability`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch stay availability");
      }
      return response.json();
    },
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
    },
  });

  useEffect(() => {
    if (stay) {
      form.reset({
        title: stay.title,
        price: stay.price,
        rating: stay.rating,
        reviewCount: stay.reviewCount,
        managerUserId: stay.managerUserId ?? "unassigned",
        location: stay.location,
        maxOccupancy: stay.maxOccupancy,
        bedrooms: stay.bedrooms,
        bathrooms: stay.bathrooms,
        imageUrl: stay.imageUrl || "",
        galleryUrls: stay.galleryUrls,
        mediaType: stay.mediaType,
        isPublic: stay.isPublic,
        description: stay.description,
        features: stay.features,
      });
      setSelectedFeatures(stay.features);
    }
  }, [stay, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return apiRequest("PATCH", `/api/admin/stays/${stayId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stays"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stays"] });
      toast({
        title: "Success",
        description: "Stay updated successfully",
      });
      setLocation("/admin/listings");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update stay",
        variant: "destructive",
      });
    },
  });

  const createBlockMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/admin/stays/${stayId}/availability/blocks`, {
        startDate: blockStartDate,
        endDate: blockEndDate,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stays", stayId, "availability"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stays", stayId, "availability"] });
      toast({
        title: "Availability updated",
        description: "Blocked dates added successfully.",
      });
      setBlockStartDate("");
      setBlockEndDate("");
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
    mutationFn: async (blockId: string) => {
      return apiRequest("DELETE", `/api/admin/stays/${stayId}/availability/blocks/${blockId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stays", stayId, "availability"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stays", stayId, "availability"] });
      toast({
        title: "Availability updated",
        description: "Blocked dates removed successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not remove block",
        description: error.message.replace(/^\d+:\s*/, ""),
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
    await updateMutation.mutateAsync({
      ...data,
      managerUserId: data.managerUserId === "unassigned" ? undefined : data.managerUserId,
      features: selectedFeatures,
    });
  };

  const handleCreateBlock = async () => {
    if (!blockStartDate || !blockEndDate) {
      toast({
        title: "Dates required",
        description: "Choose both a start date and an end date.",
        variant: "destructive",
      });
      return;
    }

    await createBlockMutation.mutateAsync();
  };

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="p-8">
          <p>Loading...</p>
        </div>
      </AdminLayout>
    );
  }

  if (!stay) {
    return (
      <AdminLayout>
        <div className="p-8">
          <p>Stay not found</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-semibold mb-2">Edit Stay</h1>
          <p className="text-muted-foreground">
            Update accommodation listing details
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Stay Details</CardTitle>
            <CardDescription>
              Modify the fields you want to update
            </CardDescription>
          </CardHeader>
          <CardContent>
            {availability && (
              <div className="mb-6 rounded-xl border bg-muted/30 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium">Availability overview</div>
                    <p className="text-sm text-muted-foreground">
                      Next open date: {availability.availableFrom}
                    </p>
                  </div>
                  <Button type="button" variant="outline" onClick={() => setLocation("/admin/bookings")}>
                    Manage Bookings
                  </Button>
                </div>

                <div className="mt-4 rounded-lg border bg-background p-4">
                  <div className="font-medium mb-3">Block dates manually</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Input type="date" value={blockStartDate} onChange={(e) => setBlockStartDate(e.target.value)} />
                    <Input type="date" value={blockEndDate} onChange={(e) => setBlockEndDate(e.target.value)} />
                    <Button
                      type="button"
                      onClick={handleCreateBlock}
                      disabled={createBlockMutation.isPending}
                    >
                      {createBlockMutation.isPending ? "Blocking..." : "Block Dates"}
                    </Button>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Use this for owner stays, maintenance, or partner-held dates.
                  </p>
                </div>

                <div className="mt-4 space-y-2">
                  {availability.blockedRanges.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No active blocked dates for this stay.</p>
                  ) : (
                    availability.blockedRanges.map((range) => (
                      <div key={range.id} className="flex items-center justify-between rounded-lg border bg-background px-4 py-3 text-sm">
                        <div>
                          <div className="font-medium">{range.startDate} to {range.endDate}</div>
                          <div className="text-muted-foreground">
                            {range.source === "manual"
                              ? "Manual availability block"
                              : `${range.guestName}${range.checkoutDate !== range.startDate ? `, checkout ${range.checkoutDate}` : ""}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-muted-foreground capitalize">
                            {range.source === "manual" ? "Blocked" : range.status}
                          </div>
                          {range.source === "manual" && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={deleteBlockMutation.isPending}
                              onClick={() => deleteBlockMutation.mutate(range.id)}
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
                  <FormLabel>Features & Amenities</FormLabel>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {featureOptions.map((feature) => (
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
                    disabled={updateMutation.isPending}
                    data-testid="button-submit-stay"
                  >
                    {updateMutation.isPending ? "Updating..." : "Update Stay"}
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
