import { useEffect, useState, type ChangeEvent } from "react";
import { useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { getCookCustomMenuRequestFee, getCookInclusivePrice, getCookServiceFee } from "@shared/cook-pricing";
import { customMenuRequestFeeDefault, insertCookSchema, type Cook } from "@shared/schema";

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

function convertKesToUsd(amountKes: number, usdToKes: number, minimumUsd = 1) {
  if (amountKes <= 0) {
    return 0;
  }

  return Math.max(minimumUsd, Math.ceil(amountKes / usdToKes));
}

export default function ProviderCookEdit() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { usdToKes } = useCurrency();
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const { data: cook, isLoading } = useQuery<Cook>({
    queryKey: ["/api/provider/cooks", id],
    enabled: !!id,
    queryFn: async () => {
      const response = await fetch(`/api/provider/cooks/${id}`, { credentials: "include" });
      if (!response.ok) {
        throw new Error("Failed to load chef listing");
      }
      return response.json();
    },
  });

  const { data: availability } = useQuery<CookAvailability>({
    queryKey: ["/api/provider/cooks", id, "availability"],
    enabled: !!id,
    queryFn: async () => {
      const response = await fetch(`/api/provider/cooks/${id}/availability`, { credentials: "include" });
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
      imageUrl: "",
      galleryUrls: [],
      mediaType: "image",
      description: "",
      features: [],
      sampleMenusText: "",
    },
  });

  useEffect(() => {
    if (!cook) return;
    form.reset({
      title: cook.title,
      location: cook.location,
      serviceType: cook.serviceType,
      speciality: cook.speciality,
      minimumGuests: cook.minimumGuests || cook.maxGuests,
      serviceFee: Math.round(getCookServiceFee(cook) * usdToKes),
      inclusivePrice: Math.round(getCookInclusivePrice(cook) * usdToKes),
      extraGuestServiceFee: Math.round((cook.extraGuestServiceFee || 0) * usdToKes),
      extraGuestInclusivePrice: Math.round((cook.extraGuestInclusivePrice || cook.extraGuestServiceFee || 0) * usdToKes),
      ingredientsIncluded: cook.ingredientsIncluded,
      shoppingIncluded: cook.shoppingIncluded,
      customMenuEnabled: cook.customMenuEnabled,
      customMenuRequestFee: Math.round(getCookCustomMenuRequestFee(cook, usdToKes) * usdToKes),
      imageUrl: cook.imageUrl || "",
      galleryUrls: cook.galleryUrls,
      mediaType: cook.mediaType,
      description: cook.description,
      features: cook.features,
      sampleMenusText: cook.sampleMenus.join("\n"),
    });
    setSelectedFeatures(cook.features);
  }, [cook, form, usdToKes]);

  const updateMutation = useMutation({
    mutationFn: async (data: CookPayload) => apiRequest("PATCH", `/api/provider/cooks/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/provider/cooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/provider/cooks", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/cooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cooks"] });
      toast({
        title: "Chef updated",
        description: "Your chef listing was updated and remains private until admin review.",
      });
      setLocation("/provider/dashboard");
    },
    onError: (error: Error) => {
      toast({
        title: "Could not update chef",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const createBlockMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/provider/cooks/${id}/availability/blocks`, { startDate, endDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/cooks", id, "availability"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cooks", id, "availability"] });
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
    mutationFn: async (blockId: string) => apiRequest("DELETE", `/api/provider/cooks/${id}/availability/blocks/${blockId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/cooks", id, "availability"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cooks", id, "availability"] });
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

    await updateMutation.mutateAsync(payload);
  };

  return (
    <ProviderLayout>
      <div className="p-8 max-w-4xl mx-auto space-y-6">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-semibold mb-2">Manage Chef Listing</h1>
          <p className="text-muted-foreground">Update your chef listing. Any edits keep it in private review mode until admin republishes it.</p>
        </div>

        <Card id="details" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Chef Details</CardTitle>
            <CardDescription>Keep your curated chef offer fresh for admin review and guest bookings.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <p>Loading...</p> : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField control={form.control} name="title" render={({ field }) => (
                    <FormItem><FormLabel>Chef Name / Title</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="location" render={({ field }) => (
                      <FormItem><FormLabel>Location</FormLabel><FormControl><Input placeholder="Westlands, Nairobi" {...field} /></FormControl><FormDescription>Where you are primarily available to deliver this chef experience.</FormDescription><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="serviceType" render={({ field }) => (
                      <FormItem><FormLabel>Service Type</FormLabel><FormControl><Input {...field} /></FormControl><FormDescription>The curated offer label guests will see first.</FormDescription><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="speciality" render={({ field }) => (
                      <FormItem><FormLabel>Speciality</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="minimumGuests" render={({ field }) => (
                    <FormItem><FormLabel>Minimum Guests</FormLabel><FormControl><Input type="number" min="1" {...field} /></FormControl><FormDescription>The minimum number of guests this menu is priced for.</FormDescription><FormMessage /></FormItem>
                  )} />
                  <div id="pricing" className="space-y-4 rounded-lg border p-5 scroll-mt-24">
                    <div>
                      <FormLabel className="text-base">Pricing Setup</FormLabel>
                      <p className="text-sm text-muted-foreground">Set a base day package for the included guests, then define the extra amount for each added guest.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField control={form.control} name="serviceFee" render={({ field }) => (
                        <FormItem><FormLabel>Base Service Fee</FormLabel><FormControl><Input type="number" min="1" {...field} /></FormControl><FormDescription>Base chef-only package price in KSh per day for the minimum guests above.</FormDescription><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="inclusivePrice" render={({ field }) => (
                        <FormItem><FormLabel>Base All Inclusive</FormLabel><FormControl><Input type="number" min="1" {...field} /></FormControl><FormDescription>Base all-inclusive package in KSh per day for the minimum guests above.</FormDescription><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="extraGuestServiceFee" render={({ field }) => (
                        <FormItem><FormLabel>Extra Guest Service Fee</FormLabel><FormControl><Input type="number" min="0" value={field.value ?? 0} onChange={(event) => handleNumberChange(field.onChange, event)} /></FormControl><FormDescription>Added in KSh per day for each guest above the base package.</FormDescription><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="extraGuestInclusivePrice" render={({ field }) => (
                        <FormItem><FormLabel>Extra Guest All Inclusive</FormLabel><FormControl><Input type="number" min="0" value={field.value ?? 0} onChange={(event) => handleNumberChange(field.onChange, event)} /></FormControl><FormDescription>Added in KSh for each extra guest on the inclusive option.</FormDescription><FormMessage /></FormItem>
                      )} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <FormField control={form.control} name="ingredientsIncluded" render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4"><div className="space-y-1"><FormLabel>Ingredients Included</FormLabel><FormDescription>Show that ingredient sourcing is covered.</FormDescription></div><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="shoppingIncluded" render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4"><div className="space-y-1"><FormLabel>Shopping Included</FormLabel><FormDescription>Show that shopping is included.</FormDescription></div><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="customMenuEnabled" render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4"><div className="space-y-1"><FormLabel>Custom Menu</FormLabel><FormDescription>Allow paid custom-menu requests.</FormDescription></div><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="customMenuRequestFee" render={({ field }) => (
                      <FormItem><FormLabel>Custom Menu Review Fee</FormLabel><FormControl><Input type="number" min="1" {...field} /></FormControl><FormDescription>Review fee in KSh. We convert and store it in USD automatically for guests.</FormDescription><FormMessage /></FormItem>
                    )} />
                  </div>
                  <div id="media" className="scroll-mt-24">
                  <FormField control={form.control} name="imageUrl" render={({ field }) => (
                    <FormItem><FormLabel>Chef Media</FormLabel><FormControl><AdminMediaField value={field.value} galleryUrls={form.watch("galleryUrls")} mediaType={form.watch("mediaType")} onChange={({ mediaUrl, mediaType, galleryUrls }) => { form.setValue("imageUrl", mediaUrl); form.setValue("galleryUrls", galleryUrls); form.setValue("mediaType", mediaType); }} /></FormControl><FormMessage /></FormItem>
                  )} />
                  </div>
                  <FormField control={form.control} name="description" render={({ field }) => (
                    <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea rows={5} {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="sampleMenusText" render={({ field }) => (
                    <FormItem><FormLabel>Sample Menus</FormLabel><FormControl><Textarea rows={4} {...field} /></FormControl><FormDescription>One sample menu per line.</FormDescription><FormMessage /></FormItem>
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
                    <Button type="submit" disabled={updateMutation.isPending}>{updateMutation.isPending ? "Saving..." : "Update Listing"}</Button>
                  </div>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>

        <Card id="availability" className="scroll-mt-24">
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
    </ProviderLayout>
  );
}
