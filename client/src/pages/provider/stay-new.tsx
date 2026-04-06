import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ProviderLayout } from "@/components/provider-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { AdminMediaField } from "@/components/admin-media-field";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/lib/currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertStaySchema } from "@shared/schema";

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
  maxOccupancy: z.coerce.number().min(1, "At least 1 guest required"),
  bedrooms: z.coerce.number().min(1, "At least 1 bedroom required"),
  bathrooms: z.coerce.number().min(1, "At least 1 bathroom required"),
});

type FormData = z.infer<typeof formSchema>;

export default function ProviderStayNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { usdToKes } = useCurrency();
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      price: 0,
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

  const createStayMutation = useMutation({
    mutationFn: async (data: FormData) => apiRequest("POST", "/api/provider/stays", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/assignments"] });
      toast({
        title: "Listing created",
        description: "Your stay was created as private and is waiting for admin review before going public.",
      });
      setLocation("/provider/dashboard");
    },
    onError: (error: Error) => {
      toast({
        title: "Could not create listing",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const handleFeatureToggle = (feature: string) => {
    const updated = selectedFeatures.includes(feature)
      ? selectedFeatures.filter((item) => item !== feature)
      : [...selectedFeatures, feature];
    setSelectedFeatures(updated);
    form.setValue("features", updated);
  };

  const onSubmit = async (data: FormData) => {
    await createStayMutation.mutateAsync({
      ...data,
      price: Math.max(1, Math.round(data.price / usdToKes)),
      isPublic: false,
      features: selectedFeatures,
    });
  };

  return (
    <ProviderLayout>
      <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-semibold mb-2">Add Stay Listing</h1>
          <p className="text-muted-foreground">
            Create your stay listing. It will remain private until an admin reviews and publishes it.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Stay Details</CardTitle>
            <CardDescription>
              Fill out the listing details and upload your property photos.
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
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input placeholder="Luxury Beach Villa" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="price"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Price per Night</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" placeholder="19500" {...field} />
                        </FormControl>
                        <FormDescription>Enter the nightly price in KSh. We convert and store it in USD automatically.</FormDescription>
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
                          <Input type="number" min="1" placeholder="4" {...field} />
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
                          <Input type="number" min="1" placeholder="3" {...field} />
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
                          <Input type="number" min="1" placeholder="2" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location</FormLabel>
                      <FormControl>
                        <Input placeholder="Diani Beach, Kenya" {...field} />
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
                      <FormLabel>Property Media</FormLabel>
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
                      <FormDescription>
                        Upload one or many property images. The app will optimize them before upload.
                      </FormDescription>
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
                        <Textarea placeholder="Describe the stay..." rows={5} {...field} />
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
                        />
                        <label className="text-sm">{feature}</label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-4 pt-4">
                  <Button type="button" variant="outline" onClick={() => setLocation("/provider/dashboard")}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createStayMutation.isPending}>
                    {createStayMutation.isPending ? "Creating..." : "Create Listing"}
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
