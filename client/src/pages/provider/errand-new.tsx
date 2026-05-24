import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ProviderLayout } from "@/components/provider-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { AdminMediaField } from "@/components/admin-media-field";
import { ErrandAddonEditor } from "@/components/errand-addon-editor";
import { HelpMamaPricingEditor } from "@/components/help-mama-pricing-editor";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/lib/currency";
import {
  convertErrandAddonsToUsd,
  convertErrandAmountToUsd,
  convertHelpMamaPricingToUsd,
  currencyLabel,
} from "@/lib/errand-currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errandAddonSchema, helpMamaPricingSchema, insertErrandSchema, type ErrandAddon, type HelpMamaPricing } from "@shared/schema";
import { getDefaultHouseCleaningAddons, normalizeHelpMamaPricing } from "@shared/errand-pricing";

const featureOptions = [
  "Same-Day Service",
  "Scheduled Service",
  "Weekend Availability",
  "Multiple Locations",
  "Childcare Support",
  "Infant Care",
  "Clinic Visit Support",
  "Family Travel Support",
  "Gentle Supervision",
  "Office Friendly",
  "Eco Products Available",
];

const formSchema = insertErrandSchema.omit({
  managerUserId: true,
  isPublic: true,
}).extend({
  basePrice: z.coerce.number().min(0, "Price cannot be negative"),
  shoppingCommissionPercent: z.coerce.number().min(0).max(100),
  laundryAddons: z.array(errandAddonSchema),
  houseCleaningAddons: z.array(errandAddonSchema),
  helpMamaPricing: helpMamaPricingSchema,
});

type FormData = z.infer<typeof formSchema>;

export default function ProviderErrandNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { selectedCurrency, convertToUsd } = useCurrency();
  const amountCurrencyLabel = currencyLabel(selectedCurrency);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [laundryAddons, setLaundryAddons] = useState<ErrandAddon[]>([]);
  const [houseCleaningAddons, setHouseCleaningAddons] = useState<ErrandAddon[]>(getDefaultHouseCleaningAddons());
  const [helpMamaPricing, setHelpMamaPricing] = useState<HelpMamaPricing>(normalizeHelpMamaPricing({ enabled: false, ageBands: [] }));

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
      houseCleaningAddons: getDefaultHouseCleaningAddons(),
      helpMamaPricing,
      imageUrl: "",
      galleryUrls: [],
      mediaType: "image",
      description: "",
      features: [],
    },
  });
  const helpMamaPricingError = form.formState.errors.helpMamaPricing as
    | { message?: string; ageBands?: { message?: string; root?: { message?: string } } }
    | undefined;

  const mutation = useMutation({
    mutationFn: async (data: FormData) => apiRequest("POST", "/api/provider/errands", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/errands"] });
      queryClient.invalidateQueries({ queryKey: ["/api/errands"] });
      toast({ title: "Errand submitted", description: "Your listing is private until admin reviews it." });
      setLocation("/provider/dashboard");
    },
    onError: (error: Error) => {
      toast({ title: "Could not create errand", description: error.message.replace(/^\d+:\s*/, ""), variant: "destructive" });
    },
  });

  const onSubmit = async (data: FormData) => {
    await mutation.mutateAsync({
      ...data,
      basePrice: convertErrandAmountToUsd(data.basePrice, convertToUsd, selectedCurrency),
      laundryPricePerKg: convertErrandAmountToUsd(data.laundryPricePerKg ?? 0, convertToUsd, selectedCurrency),
      features: selectedFeatures,
      laundryAddons: convertErrandAddonsToUsd(laundryAddons, convertToUsd, selectedCurrency),
      houseCleaningAddons: convertErrandAddonsToUsd(houseCleaningAddons, convertToUsd, selectedCurrency),
      helpMamaPricing: convertHelpMamaPricingToUsd(helpMamaPricing, convertToUsd, selectedCurrency),
    });
  };

  return (
    <ProviderLayout>
      <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-semibold mb-2">Add Errand Listing</h1>
          <p className="text-muted-foreground">Create a shopping, laundry, house cleaning, or family support listing for admin review.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Errand Details</CardTitle>
            <CardDescription>Use a simple base package and optional add-ons.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField control={form.control} name="serviceName" render={({ field }) => (
                  <FormItem><FormLabel>Service Name</FormLabel><FormControl><Input placeholder="Help Mama Family Care" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="location" render={({ field }) => (
                  <FormItem><FormLabel>Location</FormLabel><FormControl><Input placeholder="Nyali, Mtwapa, Bamburi..." {...field} /></FormControl><FormDescription>Where you mainly offer this errand package.</FormDescription><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="basePrice" render={({ field }) => (
                  <FormItem><FormLabel>Base Price ({amountCurrencyLabel})</FormLabel><FormControl><Input type="number" min="0" {...field} /></FormControl><FormDescription>For house cleaning, this is the studio / 1-bedroom rate. Use 0 when Help Mama pricing below sets the family care rates.</FormDescription><FormMessage /></FormItem>
                )} />
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField control={form.control} name="shoppingEnabled" render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4"><div><FormLabel>Shopping</FormLabel><FormDescription>Base service fee plus receipt-based commission.</FormDescription></div><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="houseCleaningEnabled" render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4"><div><FormLabel>House Cleaning</FormLabel><FormDescription>Price starts at studio / 1-bedroom, then scales by bedrooms and optional extras.</FormDescription></div><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="laundryEnabled" render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4"><div><FormLabel>Laundry</FormLabel><FormDescription>Offer basic laundry with optional heavy-item add-ons.</FormDescription></div><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="shoppingCommissionPercent" render={({ field }) => (
                    <FormItem><FormLabel>Shopping Commission %</FormLabel><FormControl><Input type="number" min="0" max="100" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
                <ErrandAddonEditor label="Laundry Add-Ons" description="Examples: duvet, large blanket, extra-heavy items." value={laundryAddons} onChange={(addons) => { setLaundryAddons(addons); form.setValue("laundryAddons", addons); }} currencyLabel={amountCurrencyLabel} />
                <ErrandAddonEditor label="House Cleaning Add-Ons" description="Examples: balcony / terrace cleaning, fridge cleaning, deep oven / stove cleaning, heavy dishwashing, deep cleaning, post-event cleanup, and deep bathroom clean." value={houseCleaningAddons} onChange={(addons) => { setHouseCleaningAddons(addons); form.setValue("houseCleaningAddons", addons); }} currencyLabel={amountCurrencyLabel} />
                <HelpMamaPricingEditor
                  value={helpMamaPricing}
                  error={helpMamaPricingError?.message || helpMamaPricingError?.ageBands?.message || helpMamaPricingError?.ageBands?.root?.message}
                  currencyLabel={amountCurrencyLabel}
                  onChange={(pricing) => { setHelpMamaPricing(pricing); form.setValue("helpMamaPricing", pricing); }}
                />
                <FormField control={form.control} name="imageUrl" render={({ field }) => (
                  <FormItem><FormLabel>Media</FormLabel><FormControl><AdminMediaField value={field.value} galleryUrls={form.watch("galleryUrls")} mediaType={form.watch("mediaType")} onChange={({ mediaUrl, mediaType, galleryUrls }) => { form.setValue("imageUrl", mediaUrl); form.setValue("galleryUrls", galleryUrls); form.setValue("mediaType", mediaType); }} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea rows={4} {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="space-y-4">
                  <FormLabel>Features</FormLabel>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {featureOptions.map((feature) => (
                      <div key={feature} className="flex items-center space-x-2">
                        <Checkbox checked={selectedFeatures.includes(feature)} onCheckedChange={() => {
                          const updated = selectedFeatures.includes(feature) ? selectedFeatures.filter((value) => value !== feature) : [...selectedFeatures, feature];
                          setSelectedFeatures(updated);
                          form.setValue("features", updated);
                        }} />
                        <label className="text-sm">{feature}</label>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-4">
                  <Button type="button" variant="outline" onClick={() => setLocation("/provider/dashboard")}>Cancel</Button>
                  <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Saving..." : "Submit Listing"}</Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </ProviderLayout>
  );
}
