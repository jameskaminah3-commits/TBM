import { useState } from "react";
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
import { CarZonePricingEditor } from "@/components/car-zone-pricing-editor";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/lib/currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertCarSchema, type CarZoneRate } from "@shared/schema";

const featureOptions = [
  "GPS Navigation",
  "Bluetooth",
  "USB Charging",
  "Air Conditioning",
  "Backup Camera",
  "Heated Seats",
  "Sunroof",
  "Leather Interior",
  "All-Wheel Drive",
  "Roof Rack",
];

const formSchema = insertCarSchema.extend({
  pricePerDay: z.preprocess(
    (val) => (val === "" || val == null ? undefined : val),
    z.coerce.number().min(1, "Price must be at least $1").optional(),
  ),
  priceWithDriver: z.coerce.number().min(1, "Chauffeur price must be at least $1"),
  priceWithDriverHourly: z.preprocess(
    (val) => (val === "" || val == null ? undefined : val),
    z.coerce.number().min(1, "Hourly chauffeur price must be at least $1").optional(),
  ),
  selfDriveMileageLimitKm: z.preprocess(
    (val) => (val === "" || val == null ? undefined : val),
    z.coerce.number().min(1, "Mileage limit must be at least 1 km").optional(),
  ),
  selfDriveExtraKmRate: z.preprocess(
    (val) => (val === "" || val == null ? undefined : val),
    z.coerce.number().min(1, "Extra km rate must be at least $1").optional(),
  ),
  seats: z.coerce.number().min(2, "At least 2 seats required"),
});

type FormData = z.infer<typeof formSchema>;

export default function ProviderCarNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { usdToKes } = useCurrency();
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [chauffeurZones, setChauffeurZones] = useState<CarZoneRate[]>([]);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      model: "",
      location: "",
      pricePerDay: undefined,
      priceWithDriver: 0,
      priceWithDriverHourly: undefined,
      chauffeurZones: [],
      selfDriveMileageLimitKm: undefined,
      selfDriveExtraKmRate: undefined,
      seats: 5,
      transmission: "automatic",
      imageUrl: "",
      galleryUrls: [],
      mediaType: "image",
      isPublic: false,
      description: "",
      features: [],
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => apiRequest("POST", "/api/provider/cars", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/assignments"] });
      toast({
        title: "Car submitted",
        description: "Your listing is saved as private until an admin reviews and publishes it.",
      });
      setLocation("/provider/dashboard");
    },
    onError: (error: Error) => {
      toast({
        title: "Could not create car",
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
    await createMutation.mutateAsync({
      ...data,
      pricePerDay: data.pricePerDay ? Math.max(1, Math.round(data.pricePerDay / usdToKes)) : undefined,
      priceWithDriver: Math.max(1, Math.round(data.priceWithDriver / usdToKes)),
      priceWithDriverHourly: data.priceWithDriverHourly ? Math.max(1, Math.round(data.priceWithDriverHourly / usdToKes)) : undefined,
      selfDriveExtraKmRate: data.selfDriveExtraKmRate ? Math.max(1, Math.round(data.selfDriveExtraKmRate / usdToKes)) : undefined,
      chauffeurZones,
      features: selectedFeatures,
    });
  };

  return (
    <ProviderLayout>
      <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-semibold mb-2">Add New Car</h1>
          <p className="text-muted-foreground">
            This form mirrors the admin car listing form. Your listing stays private until admin review.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Car Details</CardTitle>
            <CardDescription>Fill out the details for your car listing.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="model"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Model</FormLabel>
                      <FormControl>
                        <Input placeholder="Toyota Land Cruiser" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="priceWithDriver"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Chauffeur Price per Day</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" placeholder="120" {...field} />
                        </FormControl>
                        <FormDescription>Enter the amount in KSh. We convert and store it in USD automatically.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="pricePerDay"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Self-Drive Price per Day</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" placeholder="10400" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormDescription>Optional KSh self-drive price.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-3">
                  <FormLabel>Chauffeur Zones</FormLabel>
                  <CarZonePricingEditor
                    value={chauffeurZones}
                    onChange={(value) => {
                      setChauffeurZones(value);
                      form.setValue("chauffeurZones", value);
                    }}
                    currency="KES"
                    usdToKes={usdToKes}
                  />
                  <FormDescription>Optional flat zone pricing for frequent routes.</FormDescription>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="selfDriveMileageLimitKm"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Self-Drive Included Km per Day</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" placeholder="250" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormDescription>Optional mileage cap included in the daily price.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="selfDriveExtraKmRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Self-Drive Extra Km Rate</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" placeholder="130" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormDescription>Optional extra charge per km after the daily cap, entered in KSh.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="priceWithDriverHourly"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Chauffeur Price per Hour</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" placeholder="3250" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormDescription>Optional KSh hourly chauffeur price. Hourly bookings enforce a 3-hour minimum.</FormDescription>
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
                          <Input placeholder="Nairobi CBD" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="seats"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Number of Seats</FormLabel>
                        <FormControl>
                          <Input type="number" min="2" placeholder="5" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="transmission"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Transmission</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select transmission" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="automatic">Automatic</SelectItem>
                            <SelectItem value="manual">Manual</SelectItem>
                          </SelectContent>
                        </Select>
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
                      <FormLabel>Car Media</FormLabel>
                      <FormControl>
                        <AdminMediaField
                          value={field.value}
                          galleryUrls={form.watch("galleryUrls")}
                          mediaType={form.watch("mediaType")}
                          onChange={(payload) => {
                            form.setValue("galleryUrls", payload.galleryUrls);
                            form.setValue("imageUrl", payload.mediaUrl);
                          }}
                          onMediaTypeChange={(mediaType: "image" | "video") => form.setValue("mediaType", mediaType)}
                        />
                      </FormControl>
                      <FormDescription>Upload clear photos of the car.</FormDescription>
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
                        <Textarea placeholder="Describe the car..." {...field} rows={5} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-3">
                  <FormLabel>Features</FormLabel>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {featureOptions.map((feature) => (
                      <label key={feature} className="flex items-center gap-2 rounded-md border p-3 cursor-pointer">
                        <Checkbox
                          checked={selectedFeatures.includes(feature)}
                          onCheckedChange={() => handleFeatureToggle(feature)}
                        />
                        <span className="text-sm">{feature}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <Button type="button" variant="outline" onClick={() => setLocation("/provider/dashboard")}>
                    Cancel
                  </Button>
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
