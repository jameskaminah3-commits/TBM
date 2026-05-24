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
import { ErrandAddonEditor } from "@/components/errand-addon-editor";
import { HelpMamaPricingEditor } from "@/components/help-mama-pricing-editor";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/lib/currency";
import {
  convertErrandAddonsFromUsd,
  convertErrandAddonsToUsd,
  convertErrandAmountFromUsd,
  convertErrandAmountToUsd,
  convertHelpMamaPricingFromUsd,
  convertHelpMamaPricingToUsd,
  currencyLabel,
} from "@/lib/errand-currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errandAddonSchema, helpMamaPricingSchema, insertErrandSchema, type Errand, type ErrandAddon, type HelpMamaPricing, type ProviderAccountSummary } from "@shared/schema";
import { getDefaultHouseCleaningAddons, normalizeHelpMamaPricing } from "@shared/errand-pricing";

const featureOptions = [
  "Same-Day Service",
  "Next-Day Service",
  "Scheduled Service",
  "Flexible Hours",
  "Weekend Availability",
  "Evening Service",
  "24/7 Emergency",
  "Multiple Locations",
  "Childcare Support",
  "Infant Care",
  "Clinic Visit Support",
  "Family Travel Support",
  "Gentle Supervision",
  "Package Delivery",
  "Document Pickup",
];

const formSchema = insertErrandSchema.extend({
  basePrice: z.coerce.number().min(0, "Price cannot be negative"),
  shoppingCommissionPercent: z.coerce.number().min(0).max(100),
  houseCleaningEnabled: z.boolean().default(false),
  laundryIncludedKg: z.coerce.number().min(0, "Included laundry kg cannot be negative"),
  laundryPricePerKg: z.coerce.number().min(0, "Laundry price cannot be negative"),
  laundryAddons: z.array(errandAddonSchema),
  houseCleaningAddons: z.array(errandAddonSchema),
  helpMamaPricing: helpMamaPricingSchema,
  managerUserId: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

// Alias to avoid conflicts
type ErrandType = Errand;

export default function AdminErrandsEdit() {
  const params = useParams();
  const errandId = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { selectedCurrency, convertFromUsd, convertToUsd } = useCurrency();
  const amountCurrencyLabel = currencyLabel(selectedCurrency);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [laundryAddons, setLaundryAddons] = useState<ErrandAddon[]>([]);
  const [houseCleaningAddons, setHouseCleaningAddons] = useState<ErrandAddon[]>([]);
  const [helpMamaPricing, setHelpMamaPricing] = useState<HelpMamaPricing>(normalizeHelpMamaPricing({ enabled: false, ageBands: [] }));
  const { data: providers = [] } = useQuery<ProviderAccountSummary[]>({
    queryKey: ["/api/admin/provider-accounts"],
  });

  const { data: errand, isLoading } = useQuery<ErrandType>({
    queryKey: ["/api/admin/errands", errandId],
    enabled: !!errandId,
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      serviceName: "",
      location: "",
      basePrice: 0,
      shoppingEnabled: false,
      shoppingCommissionPercent: 5,
      laundryEnabled: false,
      houseCleaningEnabled: false,
      laundryIncludedKg: 0,
      laundryPricePerKg: 0,
      laundryAddons: [],
      houseCleaningAddons: [],
      helpMamaPricing,
      managerUserId: "unassigned",
      imageUrl: "",
      galleryUrls: [],
      mediaType: "image",
      isPublic: false,
      description: "",
      features: [],
    },
  });
  const helpMamaPricingError = form.formState.errors.helpMamaPricing as
    | { message?: string; ageBands?: { message?: string; root?: { message?: string } } }
    | undefined;

  useEffect(() => {
    if (errand) {
      const convertedHouseCleaningAddons = convertErrandAddonsFromUsd(errand.houseCleaningAddons, convertFromUsd, selectedCurrency);
      const houseCleaningAddonsForForm = errand.houseCleaningEnabled && convertedHouseCleaningAddons.length === 0
        ? getDefaultHouseCleaningAddons()
        : convertedHouseCleaningAddons;

      form.reset({
        serviceName: errand.serviceName,
        location: errand.location || "",
        basePrice: convertErrandAmountFromUsd(errand.basePrice, convertFromUsd, selectedCurrency),
        shoppingEnabled: errand.shoppingEnabled,
        shoppingCommissionPercent: errand.shoppingCommissionPercent,
        laundryEnabled: errand.laundryEnabled,
        houseCleaningEnabled: errand.houseCleaningEnabled,
        laundryIncludedKg: errand.laundryIncludedKg,
        laundryPricePerKg: convertErrandAmountFromUsd(errand.laundryPricePerKg, convertFromUsd, selectedCurrency),
        laundryAddons: convertErrandAddonsFromUsd(errand.laundryAddons, convertFromUsd, selectedCurrency),
        houseCleaningAddons: houseCleaningAddonsForForm,
        helpMamaPricing: convertHelpMamaPricingFromUsd(errand.helpMamaPricing, convertFromUsd, selectedCurrency),
        managerUserId: errand.managerUserId ?? "unassigned",
        imageUrl: errand.imageUrl || "",
        galleryUrls: errand.galleryUrls,
        mediaType: errand.mediaType,
        isPublic: errand.isPublic,
        description: errand.description,
        features: errand.features,
      });
      setSelectedFeatures(errand.features);
      setLaundryAddons(convertErrandAddonsFromUsd(errand.laundryAddons, convertFromUsd, selectedCurrency));
      setHouseCleaningAddons(houseCleaningAddonsForForm);
      setHelpMamaPricing(convertHelpMamaPricingFromUsd(errand.helpMamaPricing, convertFromUsd, selectedCurrency));
    }
  }, [convertFromUsd, errand, form, selectedCurrency]);

  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return apiRequest("PATCH", `/api/admin/errands/${errandId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/errands"] });
      queryClient.invalidateQueries({ queryKey: ["/api/errands"] });
      toast({
        title: "Success",
        description: "Errand service updated successfully",
      });
      setLocation("/admin/listings");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update errand service",
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
      basePrice: convertErrandAmountToUsd(data.basePrice, convertToUsd, selectedCurrency),
      laundryPricePerKg: convertErrandAmountToUsd(data.laundryPricePerKg, convertToUsd, selectedCurrency),
      features: selectedFeatures,
      laundryAddons: convertErrandAddonsToUsd(laundryAddons, convertToUsd, selectedCurrency),
      houseCleaningAddons: convertErrandAddonsToUsd(houseCleaningAddons, convertToUsd, selectedCurrency),
      helpMamaPricing: convertHelpMamaPricingToUsd(helpMamaPricing, convertToUsd, selectedCurrency),
    });
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

  if (!errand) {
    return (
      <AdminLayout>
        <div className="p-8">
          <p>Errand service not found</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-semibold mb-2">Edit Errand Service</h1>
          <p className="text-muted-foreground">
            Update errand/concierge service listing details
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Service Details</CardTitle>
            <CardDescription>
              Modify the fields you want to update
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="serviceName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Service Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Help Mama Family Care" {...field} data-testid="input-errand-service-name" />
                      </FormControl>
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
                        <Input placeholder="Mombasa Island, Nyali, Bamburi..." {...field} data-testid="input-errand-location" />
                      </FormControl>
                      <FormDescription>Where this errand package is offered or primarily served.</FormDescription>
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

                <FormField
                  control={form.control}
                  name="basePrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Base Price ({amountCurrencyLabel})</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          placeholder="0"
                          {...field}
                          data-testid="input-errand-base-price"
                        />
                      </FormControl>
                      <FormDescription>For house cleaning, this is the studio / 1-bedroom rate. Use 0 for Help Mama errands that rely on Help Mama pricing below.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-4 rounded-lg border p-5">
                  <div>
                    <FormLabel className="text-base">Optional Pricing Modes</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      Add shopping, laundry, and cleaning pricing where this errand needs more than the base service fee. Family care errands can use Help Mama pricing below instead of a base fee.
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="shoppingEnabled"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-1">
                            <FormLabel>Shopping Mode</FormLabel>
                            <FormDescription>Charge the base service fee plus receipt-based commission.</FormDescription>
                          </div>
                          <FormControl>
                            <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="laundryEnabled"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-1">
                            <FormLabel>Laundry Mode</FormLabel>
                            <FormDescription>Base fee can include a set weight, then only extra kg is charged.</FormDescription>
                          </div>
                          <FormControl>
                            <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="houseCleaningEnabled"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-1">
                            <FormLabel>House Cleaning</FormLabel>
                            <FormDescription>Price starts at studio / 1-bedroom, then scales by bedrooms and optional extras.</FormDescription>
                          </div>
                          <FormControl>
                            <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="shoppingCommissionPercent"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Shopping Commission %</FormLabel>
                          <FormControl>
                            <Input type="number" min="0" max="100" placeholder="5" {...field} />
                          </FormControl>
                          <FormDescription>Percentage applied to the final shopping receipt value.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                  </div>

                  <ErrandAddonEditor
                    label="Laundry Add-Ons"
                    description="Examples: duvet, large blanket, extra-heavy items."
                    value={laundryAddons}
                    currencyLabel={amountCurrencyLabel}
                    onChange={(addons) => {
                      setLaundryAddons(addons);
                      form.setValue("laundryAddons", addons);
                    }}
                  />

                  <ErrandAddonEditor
                    label="House Cleaning Add-Ons"
                    description="Examples: balcony / terrace cleaning, fridge cleaning, deep oven / stove cleaning, heavy dishwashing, deep cleaning, post-event cleanup, and deep bathroom clean."
                    value={houseCleaningAddons}
                    currencyLabel={amountCurrencyLabel}
                    onChange={(addons) => {
                      setHouseCleaningAddons(addons);
                      form.setValue("houseCleaningAddons", addons);
                    }}
                  />

                  <HelpMamaPricingEditor
                    value={helpMamaPricing}
                    error={helpMamaPricingError?.message || helpMamaPricingError?.ageBands?.message || helpMamaPricingError?.ageBands?.root?.message}
                    currencyLabel={amountCurrencyLabel}
                    onChange={(pricing) => {
                      setHelpMamaPricing(pricing);
                      form.setValue("helpMamaPricing", pricing);
                    }}
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
                        <FormDescription>Turn this on when the service should appear on the live site.</FormDescription>
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
                          placeholder="Describe the errand service, who it helps, and what is included..."
                          rows={4}
                          {...field}
                          data-testid="input-errand-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-4">
                  <FormLabel>Service Features</FormLabel>
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
                    data-testid="button-cancel-errand"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={updateMutation.isPending}
                    data-testid="button-submit-errand"
                  >
                    {updateMutation.isPending ? "Updating..." : "Update Service"}
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
