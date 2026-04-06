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
import { CarZonePricingEditor } from "@/components/car-zone-pricing-editor";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertCarSchema, type Car, type CarZoneRate, type ProviderAccountSummary } from "@shared/schema";

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
    (val) => (val === "" || val == null) ? undefined : val,
    z.coerce.number().min(1, "Price must be at least $1").optional()
  ),
  priceWithDriver: z.coerce.number().min(1, "Chauffeur price must be at least $1"),
  priceWithDriverHourly: z.preprocess(
    (val) => (val === "" || val == null) ? undefined : val,
    z.coerce.number().min(1, "Hourly chauffeur price must be at least $1").optional()
  ),
  selfDriveMileageLimitKm: z.preprocess(
    (val) => (val === "" || val == null) ? undefined : val,
    z.coerce.number().min(1, "Mileage limit must be at least 1 km").optional()
  ),
  selfDriveExtraKmRate: z.preprocess(
    (val) => (val === "" || val == null) ? undefined : val,
    z.coerce.number().min(1, "Extra km rate must be at least $1").optional()
  ),
  managerUserId: z.string().optional(),
  seats: z.coerce.number().min(2, "At least 2 seats required"),
});

type FormData = z.infer<typeof formSchema>;

// Alias to avoid conflict with lucide-react Car icon
type CarType = Car;

export default function AdminCarsEdit() {
  const params = useParams();
  const carId = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [chauffeurZones, setChauffeurZones] = useState<CarZoneRate[]>([]);
  const { data: providers = [] } = useQuery<ProviderAccountSummary[]>({
    queryKey: ["/api/admin/provider-accounts"],
  });

  const { data: car, isLoading } = useQuery<CarType>({
    queryKey: ["/api/admin/cars", carId],
    enabled: !!carId,
  });

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
      managerUserId: "unassigned",
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

  useEffect(() => {
    if (car) {
      form.reset({
        model: car.model,
        location: car.location,
        pricePerDay: car.pricePerDay ?? undefined,
        priceWithDriver: car.priceWithDriver,
        priceWithDriverHourly: car.priceWithDriverHourly || undefined,
        chauffeurZones: car.chauffeurZones ?? [],
        selfDriveMileageLimitKm: car.selfDriveMileageLimitKm ?? undefined,
        selfDriveExtraKmRate: car.selfDriveExtraKmRate ?? undefined,
        managerUserId: car.managerUserId ?? "unassigned",
        seats: car.seats,
        transmission: car.transmission,
        imageUrl: car.imageUrl || "",
        galleryUrls: car.galleryUrls,
        mediaType: car.mediaType,
        isPublic: car.isPublic,
        description: car.description,
        features: car.features,
      });
      setSelectedFeatures(car.features);
      setChauffeurZones(car.chauffeurZones ?? []);
    }
  }, [car, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return apiRequest("PATCH", `/api/admin/cars/${carId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cars"] });
      toast({
        title: "Success",
        description: "Car updated successfully",
      });
      setLocation("/admin/listings");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update car",
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
      chauffeurZones,
      features: selectedFeatures,
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

  if (!car) {
    return (
      <AdminLayout>
        <div className="p-8">
          <p>Car not found</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-semibold mb-2">Edit Car</h1>
          <p className="text-muted-foreground">
            Update car rental listing details
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Car Details</CardTitle>
            <CardDescription>
              Modify the fields you want to update
            </CardDescription>
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
                        <Input placeholder="Toyota Land Cruiser" {...field} data-testid="input-car-model" />
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
                          <Input
                            type="number"
                            min="1"
                            placeholder="120"
                            {...field}
                            value={field.value || ""}
                            data-testid="input-car-price-with-driver"
                          />
                        </FormControl>
                        <FormDescription>USD per day</FormDescription>
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
                          <Input
                            type="number"
                            min="1"
                            placeholder="80"
                            {...field}
                            value={field.value || ""}
                            data-testid="input-car-price-per-day"
                          />
                        </FormControl>
                        <FormDescription>Optional. Leave empty if this car is chauffeur-only.</FormDescription>
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
                  />
                  <FormDescription>
                    Add optional flat zone pricing for airport, SGR, CBD, and other frequent routes.
                  </FormDescription>
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
                          <Input type="number" min="1" placeholder="1" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormDescription>Optional extra charge per km after the daily cap.</FormDescription>
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
                          <Input
                            type="number"
                            min="1"
                            placeholder="25"
                            {...field}
                            value={field.value || ""}
                            data-testid="input-car-price-with-driver-hourly"
                          />
                        </FormControl>
                        <FormDescription>Optional. Hourly bookings will enforce a 3-hour minimum.</FormDescription>
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
                          <Input placeholder="Nairobi CBD" {...field} data-testid="input-car-location" />
                        </FormControl>
                        <FormDescription>Where the car is based or usually dispatched from.</FormDescription>
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
                          <Input
                            type="number"
                            min="2"
                            placeholder="5"
                            {...field}
                            data-testid="input-car-seats"
                          />
                        </FormControl>
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
                    name="transmission"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Transmission</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-car-transmission">
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
                        <FormDescription>Turn this on when the car should appear on the live site.</FormDescription>
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
                          placeholder="Describe the car..."
                          rows={4}
                          {...field}
                          data-testid="input-car-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-4">
                  <FormLabel>Features</FormLabel>
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
                    data-testid="button-cancel-car"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={updateMutation.isPending}
                    data-testid="button-submit-car"
                  >
                    {updateMutation.isPending ? "Updating..." : "Update Car"}
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
