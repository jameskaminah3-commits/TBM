import { useState, type ChangeEvent } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ProviderLayout } from "@/components/provider-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { AdminMediaField } from "@/components/admin-media-field";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/lib/currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { customMenuRequestFeeDefault, insertCookSchema } from "@shared/schema";

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
  managerUserId: true,
  isPublic: true,
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
  sampleMenusText: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;
type CookPayload = Omit<FormData, "sampleMenusText"> & { maxGuests: number; pricePerSession: number; customMenuRequestFeeKes: number; sampleMenus: string[] };

function convertKesToUsd(amountKes: number, usdToKes: number, minimumUsd = 1) {
  if (amountKes <= 0) {
    return 0;
  }

  return Math.max(minimumUsd, Math.ceil(amountKes / usdToKes));
}

export default function ProviderCookNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { usdToKes } = useCurrency();
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);

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
      imageUrl: "",
      galleryUrls: [],
      mediaType: "image",
      description: "",
      features: [],
      sampleMenusText: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CookPayload) => apiRequest("POST", "/api/provider/cooks", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/provider/cooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cooks"] });
      toast({
        title: "Chef submitted",
        description: "Your chef listing is saved as private until admin review and publication.",
      });
      setLocation("/provider/dashboard");
    },
    onError: (error: Error) => {
      toast({
        title: "Could not create chef",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const handleFeatureToggle = (feature: string) => {
    const updated = selectedFeatures.includes(feature)
      ? selectedFeatures.filter((value) => value !== feature)
      : [...selectedFeatures, feature];
    setSelectedFeatures(updated);
    form.setValue("features", updated);
  };

  const onSubmit = async (data: FormData) => {
    const baseServiceFeeUsd = convertKesToUsd(data.serviceFee, usdToKes);
    const baseInclusiveFeeUsd = convertKesToUsd(data.inclusivePrice, usdToKes);

    const payload: CookPayload = {
      ...data,
      maxGuests: data.minimumGuests,
      serviceFee: baseServiceFeeUsd,
      inclusivePrice: baseInclusiveFeeUsd,
      extraGuestServiceFee: convertKesToUsd(data.extraGuestServiceFee, usdToKes, 1),
      extraGuestInclusivePrice: convertKesToUsd(data.extraGuestInclusivePrice, usdToKes, 1),
      customMenuRequestFee: convertKesToUsd(data.customMenuRequestFee, usdToKes),
      pricePerSession: baseServiceFeeUsd,
      customMenuRequestFeeKes: Math.round(data.customMenuRequestFee),
      features: selectedFeatures,
      sampleMenus: parseSampleMenus(data.sampleMenusText || ""),
    };

    await createMutation.mutateAsync(payload);
  };

  return (
    <ProviderLayout>
      <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-semibold mb-2">Add Chef Listing</h1>
          <p className="text-muted-foreground">
            This mirrors the admin chef form. Your listing stays private until an admin reviews and publishes it.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Chef Details</CardTitle>
            <CardDescription>Build a curated cook or chef experience for guests.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField control={form.control} name="title" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chef Name / Title</FormLabel>
                    <FormControl><Input placeholder="Chef Amina" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField control={form.control} name="location" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location</FormLabel>
                      <FormControl><Input placeholder="Westlands, Nairobi" {...field} /></FormControl>
                      <FormDescription>Where you are primarily available to deliver this chef experience.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="serviceType" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Service Type</FormLabel>
                      <FormControl><Input placeholder="Private chef experience" {...field} /></FormControl>
                      <FormDescription>The curated offer label guests will see first.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="speciality" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Speciality</FormLabel>
                      <FormControl><Input placeholder="Swahili coastal cuisine" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField control={form.control} name="minimumGuests" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minimum Guests</FormLabel>
                      <FormControl><Input type="number" min="1" placeholder="8" {...field} /></FormControl>
                      <FormDescription>The minimum number of guests this menu is priced for.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="space-y-4 rounded-lg border p-5">
                  <div>
                    <FormLabel className="text-base">Pricing Setup</FormLabel>
                    <p className="text-sm text-muted-foreground">Set a base day package that covers a specific guest count, then define the add-on price for each extra guest.</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="serviceFee" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Base Service Fee</FormLabel>
                        <FormControl><Input type="number" min="1" placeholder="19500" {...field} /></FormControl>
                        <FormDescription>Base chef-only package price in KSh per day for the minimum guests above.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="inclusivePrice" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Base All Inclusive</FormLabel>
                        <FormControl><Input type="number" min="1" placeholder="33800" {...field} /></FormControl>
                        <FormDescription>Base all-inclusive package in KSh per day for the minimum guests above.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="extraGuestServiceFee" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Extra Guest Service Fee</FormLabel>
                        <FormControl><Input type="number" min="0" placeholder="900" value={field.value ?? 0} onChange={(event) => handleNumberChange(field.onChange, event)} /></FormControl>
                        <FormDescription>Added in KSh per day for each guest above the base package.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="extraGuestInclusivePrice" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Extra Guest All Inclusive</FormLabel>
                        <FormControl><Input type="number" min="0" placeholder="1400" value={field.value ?? 0} onChange={(event) => handleNumberChange(field.onChange, event)} /></FormControl>
                        <FormDescription>Added in KSh for each extra guest on the inclusive option.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField control={form.control} name="ingredientsIncluded" render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-1">
                          <FormLabel>Ingredients Included</FormLabel>
                          <FormDescription>Show that ingredient sourcing is covered.</FormDescription>
                        </div>
                        <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="shoppingIncluded" render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-1">
                          <FormLabel>Shopping Included</FormLabel>
                          <FormDescription>Show that market or grocery shopping is included.</FormDescription>
                        </div>
                        <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="customMenuEnabled" render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-1">
                          <FormLabel>Custom Menu</FormLabel>
                          <FormDescription>Allow paid custom-menu requests for pricing review.</FormDescription>
                        </div>
                        <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="customMenuRequestFee" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Custom Menu Review Fee</FormLabel>
                      <FormControl><Input type="number" min="1" placeholder="500" {...field} /></FormControl>
                      <FormDescription>Review fee in KSh. We convert and store it in USD automatically for the marketplace.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="imageUrl" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chef Media</FormLabel>
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
                )} />

                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={5}
                        placeholder="Describe the curated chef experience, ideal occasions, menu strengths, dietary flexibility, and how each pricing option works."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="sampleMenusText" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sample Menus</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={4}
                        placeholder={"Sunset seafood dinner\nFamily-style Swahili feast\nGarden brunch with fresh pastries"}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>One sample menu per line. These sit under your pictures and description to help guests understand your style.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="space-y-3">
                  <FormLabel>Specialties & Skills</FormLabel>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {featureOptions.map((feature) => (
                      <label key={feature} className="flex items-center gap-2 rounded-md border p-3 cursor-pointer">
                        <Checkbox checked={selectedFeatures.includes(feature)} onCheckedChange={() => handleFeatureToggle(feature)} />
                        <span className="text-sm">{feature}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <Button type="button" variant="outline" onClick={() => setLocation("/provider/dashboard")}>Cancel</Button>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Saving..." : "Create Listing"}
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
