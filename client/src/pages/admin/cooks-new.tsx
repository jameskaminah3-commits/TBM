import { useState, type ChangeEvent } from "react";
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
import { useCurrency } from "@/lib/currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { customMenuRequestFeeDefault, insertCookSchema, type ProviderAccountSummary } from "@shared/schema";

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

export default function AdminCooksNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { usdToKes } = useCurrency();
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const { data: providers = [] } = useQuery<ProviderAccountSummary[]>({
    queryKey: ["/api/admin/provider-accounts"],
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

  const createMutation = useMutation({
    mutationFn: async (data: CookPayload) => {
      return apiRequest("POST", "/api/admin/cooks", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/provider/assignments"] });
      toast({
        title: "Success",
        description: "Cook created successfully",
      });
      setLocation("/admin/listings");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create cook",
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

    await createMutation.mutateAsync(payload);
  };

  return (
    <AdminLayout>
      <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-semibold mb-2">Add New Personal Chef</h1>
          <p className="text-muted-foreground">
            Create a new personal chef listing
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Chef Details</CardTitle>
            <CardDescription>
              Fill out all required fields to create a new personal chef
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
                        <FormDescription>The curated service title clients will immediately understand.</FormDescription>
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
                      Set the base package for the included guests, then define the extra amount for every added guest.
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
                              data-testid="input-cook-extra-service-fee"
                            />
                          </FormControl>
                          <FormDescription>Added in USD for each extra guest above the base package.</FormDescription>
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
                              data-testid="input-cook-extra-inclusive-fee"
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
                            <FormDescription>Allow proposal-based custom menu requests.</FormDescription>
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
                        <FormDescription>Base fee in USD. It will convert to KSh automatically wherever the client is viewing prices.</FormDescription>
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
                          placeholder="Describe the curated chef experience: what the chef prepares well, how service works on-site, ideal occasions, dietary flexibility, and what clients can expect from service fee, all-inclusive, and custom menu options."
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
                      <FormDescription>Enter one sample menu per line. These appear under the chef description to guide clients before they request a custom menu.</FormDescription>
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
                    disabled={createMutation.isPending}
                    data-testid="button-submit-cook"
                  >
                    {createMutation.isPending ? "Creating..." : "Create Chef"}
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
