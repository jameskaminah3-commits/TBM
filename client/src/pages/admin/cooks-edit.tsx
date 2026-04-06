import { useState, useEffect, type ChangeEvent } from "react";
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
import { useCurrency } from "@/lib/currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getCookCustomMenuRequestFee, getCookInclusivePrice, getCookServiceFee } from "@shared/cook-pricing";
import { customMenuRequestFeeDefault, insertCookSchema, type Cook, type ProviderAccountSummary } from "@shared/schema";

const featureOptions = [
  "African Cuisine",
  "Italian Cuisine",
  "Asian Fusion",
  "BBQ Specialist",
  "Vegetarian/Vegan",
  "Baking & Pastry",
  "Seafood Expert",
  "Fine Dining",
  "Meal Prep Services",
  "Dietary Restrictions Expert",
];

function parseSampleMenus(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function handleNumberChange(
  onChange: (value: number) => void,
  event: ChangeEvent<HTMLInputElement>,
) {
  const nextValue = event.target.value;
  onChange(nextValue === "" ? 0 : Number(nextValue));
}

const formSchema = insertCookSchema.omit({
  pricePerSession: true,
  customMenuRequestFeeKes: true,
  sampleMenus: true,
  maxGuests: true,
}).extend({
  serviceType: z.string().min(2, "Service type is required"),
  minimumGuests: z.coerce.number().min(1, "Minimum guests must be at least 1"),
  serviceFee: z.coerce.number().min(1, "Service fee must be at least $1"),
  inclusivePrice: z.coerce.number().min(1, "Inclusive package must be at least $1"),
  extraGuestServiceFee: z.coerce.number().min(0, "Extra guest fee cannot be negative"),
  extraGuestInclusivePrice: z.coerce.number().min(0, "Extra guest inclusive fee cannot be negative"),
  customMenuRequestFee: z.coerce.number().min(1, "Custom menu review fee must be at least $1"),
  managerUserId: z.string().optional(),
  sampleMenusText: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;
type CookPayload = Omit<FormData, "sampleMenusText"> & { maxGuests: number; pricePerSession: number; customMenuRequestFeeKes: number; sampleMenus: string[] };
type CookAvailability = {
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

// Alias to avoid conflict with lucide-react icons
type CookType = Cook;

export default function AdminCooksEdit() {
  const params = useParams();
  const cookId = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { usdToKes } = useCurrency();
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const { data: providers = [] } = useQuery<ProviderAccountSummary[]>({
    queryKey: ["/api/admin/provider-accounts"],
  });

  const { data: cook, isLoading } = useQuery<CookType>({
    queryKey: ["/api/admin/cooks", cookId],
    enabled: !!cookId,
  });

  const { data: availability } = useQuery<CookAvailability>({
    queryKey: ["/api/admin/cooks", cookId, "availability"],
    enabled: !!cookId,
    queryFn: async () => {
      const response = await fetch(`/api/admin/cooks/${cookId}/availability`, { credentials: "include" });
      if (!response.ok) {
        throw new Error("Failed to load chef availability");
      }
      return response.json();
    },
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      location: "",
      serviceType: "Private chef experience",
      speciality: "",
      minimumGuests: 2,
      serviceFee: 0,
      inclusivePrice: 0,
      extraGuestServiceFee: 0,
      extraGuestInclusivePrice: 0,
      ingredientsIncluded: true,
      shoppingIncluded: true,
      customMenuEnabled: true,
      customMenuRequestFee: customMenuRequestFeeDefault,
      managerUserId: "unassigned",
      imageUrl: "",
      galleryUrls: [],
      mediaType: "image",
      isPublic: false,
      description: "",
      features: [],
      sampleMenusText: "",
    },
  });

  useEffect(() => {
    if (cook) {
      form.reset({
        title: cook.title,
        location: cook.location,
        serviceType: cook.serviceType,
        speciality: cook.speciality,
        minimumGuests: cook.minimumGuests || cook.maxGuests,
        serviceFee: getCookServiceFee(cook),
        inclusivePrice: getCookInclusivePrice(cook),
        extraGuestServiceFee: cook.extraGuestServiceFee || 0,
        extraGuestInclusivePrice: cook.extraGuestInclusivePrice || cook.extraGuestServiceFee || 0,
        ingredientsIncluded: cook.ingredientsIncluded,
        shoppingIncluded: cook.shoppingIncluded,
        customMenuEnabled: cook.customMenuEnabled,
        customMenuRequestFee: getCookCustomMenuRequestFee(cook, usdToKes),
        managerUserId: cook.managerUserId ?? "unassigned",
        imageUrl: cook.imageUrl || "",
        galleryUrls: cook.galleryUrls,
        mediaType: cook.mediaType,
        isPublic: cook.isPublic,
        description: cook.description,
        features: cook.features,
        sampleMenusText: cook.sampleMenus.join("\n"),
      });
      setSelectedFeatures(cook.features);
    }
  }, [cook, form, usdToKes]);

  const updateMutation = useMutation({
    mutationFn: async (data: CookPayload) => {
      return apiRequest("PATCH", `/api/admin/cooks/${cookId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cooks", cookId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/provider/assignments"] });
      toast({
        title: "Success",
        description: "Chef updated successfully",
      });
      setLocation("/admin/listings");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update chef",
        variant: "destructive",
      });
    },
  });

  const createBlockMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/cooks/${cookId}/availability/blocks`, { startDate, endDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cooks", cookId, "availability"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cooks", cookId, "availability"] });
      setStartDate("");
      setEndDate("");
      toast({ title: "Dates blocked", description: "Chef availability updated successfully." });
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
    mutationFn: async (blockId: string) => apiRequest("DELETE", `/api/admin/cooks/${cookId}/availability/blocks/${blockId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cooks", cookId, "availability"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cooks", cookId, "availability"] });
      toast({ title: "Block removed", description: "Chef availability updated successfully." });
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
    const payload: CookPayload = {
      ...data,
      maxGuests: data.minimumGuests,
      pricePerSession: data.serviceFee,
      extraGuestServiceFee: data.extraGuestServiceFee,
      extraGuestInclusivePrice: data.extraGuestInclusivePrice,
      customMenuRequestFeeKes: Math.round(data.customMenuRequestFee * usdToKes),
      managerUserId: data.managerUserId === "unassigned" ? undefined : data.managerUserId,
      features: selectedFeatures,
      sampleMenus: parseSampleMenus(data.sampleMenusText || ""),
    };

    await updateMutation.mutateAsync(payload);
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

  if (!cook) {
    return (
      <AdminLayout>
        <div className="p-8">
          <p>Chef not found</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="p-8 max-w-4xl mx-auto space-y-6">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-semibold mb-2">Edit Personal Chef</h1>
          <p className="text-muted-foreground">
            Update personal chef listing details
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Chef Details</CardTitle>
            <CardDescription>
              Modify the fields you want to update
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
                      <FormLabel>Chef Name/Title</FormLabel>
                      <FormControl>
                        <Input placeholder="Chef Maria Santos" {...field} data-testid="input-cook-title" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Location</FormLabel>
                        <FormControl>
                          <Input placeholder="Westlands, Nairobi" {...field} data-testid="input-cook-location" />
                        </FormControl>
                        <FormDescription>Where this chef is primarily available for bookings.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="serviceType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Service Type</FormLabel>
                        <FormControl>
                          <Input placeholder="Private chef experience" {...field} data-testid="input-cook-service-type" />
                        </FormControl>
                        <FormDescription>The curated service title shown to clients.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="speciality"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Speciality</FormLabel>
                        <FormControl>
                          <Input placeholder="Italian Cuisine" {...field} data-testid="input-cook-speciality" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="minimumGuests"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Minimum Guests</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" placeholder="2" {...field} data-testid="input-cook-minimum-guests" />
                        </FormControl>
                        <FormDescription>The minimum number of guests this pricing starts from.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

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
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                </div>

                <div className="space-y-4 rounded-lg border p-5">
                  <div>
                    <FormLabel className="text-base">Pricing Setup</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      Manage the base package for the included guests, then define the extra amount for every added guest.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="serviceFee"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Base Service Fee</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min="1"
                              placeholder="150"
                              {...field}
                              data-testid="input-cook-service-fee"
                            />
                          </FormControl>
                          <FormDescription>Base chef-only package in USD for the minimum guests above.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="inclusivePrice"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Ingredients + Shopping Inclusive</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min="1"
                              placeholder="260"
                              {...field}
                              data-testid="input-cook-inclusive-price"
                            />
                          </FormControl>
                          <FormDescription>Base inclusive package in USD for the minimum guests above.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="extraGuestServiceFee"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Extra Guest Service Fee</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min="0"
                              placeholder="7"
                              value={field.value ?? 0}
                              onChange={(event) => handleNumberChange(field.onChange, event)}
                            />
                          </FormControl>
                          <FormDescription>Added in USD for each guest above the base package.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="extraGuestInclusivePrice"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Extra Guest Inclusive Fee</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min="0"
                              placeholder="12"
                              value={field.value ?? 0}
                              onChange={(event) => handleNumberChange(field.onChange, event)}
                            />
                          </FormControl>
                          <FormDescription>Added in USD for each extra guest on the inclusive option.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="ingredientsIncluded"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-1">
                            <FormLabel>Ingredients Included</FormLabel>
                            <FormDescription>Show that ingredient sourcing is covered.</FormDescription>
                          </div>
                          <FormControl>
                            <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="shoppingIncluded"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-1">
                            <FormLabel>Shopping Included</FormLabel>
                            <FormDescription>Show that chef shopping is included.</FormDescription>
                          </div>
                          <FormControl>
                            <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="customMenuEnabled"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-1">
                            <FormLabel>Custom Menu</FormLabel>
                            <FormDescription>Allow proposal-based menu requests.</FormDescription>
                          </div>
                          <FormControl>
                            <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="customMenuRequestFee"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Custom Menu Review Fee</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="1"
                            placeholder={String(customMenuRequestFeeDefault)}
                            {...field}
                            data-testid="input-cook-custom-menu-fee"
                          />
                        </FormControl>
                        <FormDescription>Base fee in USD. It converts automatically into KSh wherever needed.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

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
                        <FormDescription>Turn this on when the chef should appear on the live site.</FormDescription>
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
                          placeholder="Describe the curated chef experience, ideal occasions, menu strengths, dietary flexibility, and how service fee, all-inclusive, and custom menu work."
                          rows={5}
                          {...field}
                          data-testid="input-cook-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                    )}
                />

                <FormField
                  control={form.control}
                  name="sampleMenusText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sample Menus</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={"Sunset seafood dinner\nFamily-style Swahili feast\nGarden brunch with fresh pastries"}
                          rows={4}
                          {...field}
                          data-testid="input-cook-sample-menus"
                        />
                      </FormControl>
                      <FormDescription>Enter one sample menu per line so guests can see examples before booking or requesting a custom menu.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-4">
                  <FormLabel>Specialties & Skills</FormLabel>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {featureOptions.map((feature) => (
                      <div key={feature} className="flex items-center space-x-2">
                        <Checkbox
                          checked={selectedFeatures.includes(feature)}
                          onCheckedChange={() => handleFeatureToggle(feature)}
                          data-testid={`checkbox-feature-${feature.toLowerCase().replace(/\s/g, "-").replace(/\//g, "-")}`}
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
                    data-testid="button-cancel-cook"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={updateMutation.isPending}
                    data-testid="button-submit-cook"
                  >
                    {updateMutation.isPending ? "Updating..." : "Update Chef"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Availability</CardTitle>
            <CardDescription>
              Next available date: {availability?.availableFrom ?? "Loading..."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              <Button onClick={() => createBlockMutation.mutate()} disabled={createBlockMutation.isPending}>
                {createBlockMutation.isPending ? "Blocking..." : "Mark Unavailable"}
              </Button>
            </div>

            <div className="space-y-3">
              {availability?.blockedRanges?.length ? availability.blockedRanges.map((range) => (
                <div key={range.id} className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <div className="font-medium">{range.startDate} to {range.endDate}</div>
                    <div className="text-sm text-muted-foreground">
                      {range.source === "manual"
                        ? "Manual unavailable block"
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
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
