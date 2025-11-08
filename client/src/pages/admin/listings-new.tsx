import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertListingSchema } from "@shared/schema";

const featureOptions = [
  "WiFi",
  "Hot Shower",
  "Parking",
  "Kitchen",
  "Smart TV",
  "Driver",
  "Air Conditioning",
  "Pool",
  "Gym",
  "Ocean View",
  "Mountain View",
  "Pet Friendly",
  "Wheelchair Accessible",
];

const formSchema = insertListingSchema.extend({
  price: z.coerce.number().min(1, "Price must be at least $1"),
});

type FormData = z.infer<typeof formSchema>;

export default function AdminListingsNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      category: "",
      price: 0,
      location: "",
      imageUrl: "",
      description: "",
      features: [],
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return apiRequest("POST", "/api/admin/listings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/listings"] });
      toast({
        title: "Success",
        description: "Listing created successfully",
      });
      setLocation("/admin/listings");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create listing",
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
    await createMutation.mutateAsync({ ...data, features: selectedFeatures });
  };

  return (
    <AdminLayout>
      <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-semibold mb-2">Add New Listing</h1>
          <p className="text-muted-foreground">
            Create a new listing for stays, cars, cooks, or errands
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Listing Details</CardTitle>
            <CardDescription>
              Fill out all required fields to create a new listing
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
                      <FormLabel>Title *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g., Luxury Beachfront Villa"
                          {...field}
                          data-testid="input-title"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-category">
                            <SelectValue placeholder="Select a category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="stays" data-testid="option-stays">Stays</SelectItem>
                          <SelectItem value="cars" data-testid="option-cars">Cars</SelectItem>
                          <SelectItem value="cooks" data-testid="option-cooks">Cooks</SelectItem>
                          <SelectItem value="errands" data-testid="option-errands">Errands</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Choose the category this listing belongs to
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Price (USD) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="0"
                          min="1"
                          {...field}
                          data-testid="input-price"
                        />
                      </FormControl>
                      <FormDescription>
                        Price per day or per service
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g., Malibu, California"
                          {...field}
                          data-testid="input-location"
                        />
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
                      <FormLabel>Image URL</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="https://example.com/image.jpg"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-image-url"
                        />
                      </FormControl>
                      <FormDescription>
                        Optional: URL to the main image
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
                      <FormLabel>Description *</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Describe the listing in detail..."
                          className="min-h-[120px]"
                          {...field}
                          data-testid="textarea-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-3">
                  <FormLabel>Features</FormLabel>
                  <FormDescription>
                    Select all features that apply to this listing
                  </FormDescription>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {featureOptions.map((feature) => (
                      <div key={feature} className="flex items-center space-x-2">
                        <Checkbox
                          id={feature}
                          checked={selectedFeatures.includes(feature)}
                          onCheckedChange={() => handleFeatureToggle(feature)}
                          data-testid={`checkbox-${feature.toLowerCase().replace(/\s+/g, '-')}`}
                        />
                        <label
                          htmlFor={feature}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                          {feature}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-4 pt-4">
                  <Button
                    type="submit"
                    disabled={createMutation.isPending}
                    data-testid="button-submit"
                  >
                    {createMutation.isPending ? "Creating..." : "Create Listing"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setLocation("/admin/listings")}
                    data-testid="button-cancel"
                  >
                    Cancel
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
