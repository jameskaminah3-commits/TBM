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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertErrandSchema, type Errand } from "@shared/schema";

const featureOptions = [
  "Same-Day Service",
  "Next-Day Service",
  "Scheduled Service",
  "Flexible Hours",
  "Weekend Availability",
  "Evening Service",
  "24/7 Emergency",
  "Multiple Locations",
  "Package Delivery",
  "Document Pickup",
];

const formSchema = insertErrandSchema.extend({
  basePrice: z.coerce.number().min(1, "Price must be at least $1"),
});

type FormData = z.infer<typeof formSchema>;

// Alias to avoid conflicts
type ErrandType = Errand;

export default function AdminErrandsEdit() {
  const params = useParams();
  const errandId = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);

  const { data: errand, isLoading } = useQuery<ErrandType>({
    queryKey: ["/api/admin/errands", errandId],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      serviceName: "",
      basePrice: 0,
      imageUrl: "",
      description: "",
      features: [],
    },
  });

  useEffect(() => {
    if (errand) {
      form.reset({
        serviceName: errand.serviceName,
        basePrice: errand.basePrice,
        imageUrl: errand.imageUrl || "",
        description: errand.description,
        features: errand.features,
      });
      setSelectedFeatures(errand.features);
    }
  }, [errand, form]);

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
    await updateMutation.mutateAsync({ ...data, features: selectedFeatures });
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
                        <Input placeholder="Grocery Shopping & Delivery" {...field} data-testid="input-errand-service-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="basePrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Base Price</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          placeholder="50"
                          {...field}
                          data-testid="input-errand-base-price"
                        />
                      </FormControl>
                      <FormDescription>Starting price in USD</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="imageUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Image URL (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          type="url"
                          placeholder="https://example.com/image.jpg"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-errand-image-url"
                        />
                      </FormControl>
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
                        <Textarea
                          placeholder="Describe the errand service..."
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
