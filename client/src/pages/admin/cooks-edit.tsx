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
import { insertCookSchema, type Cook } from "@shared/schema";

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

const formSchema = insertCookSchema.extend({
  pricePerSession: z.coerce.number().min(1, "Price must be at least $1"),
});

type FormData = z.infer<typeof formSchema>;

// Alias to avoid conflict with lucide-react icons
type CookType = Cook;

export default function AdminCooksEdit() {
  const params = useParams();
  const cookId = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);

  const { data: cook, isLoading } = useQuery<CookType>({
    queryKey: ["/api/admin/cooks", cookId],
    enabled: !!cookId,
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      speciality: "",
      pricePerSession: 0,
      imageUrl: "",
      description: "",
      features: [],
    },
  });

  useEffect(() => {
    if (cook) {
      form.reset({
        title: cook.title,
        speciality: cook.speciality,
        pricePerSession: cook.pricePerSession,
        imageUrl: cook.imageUrl || "",
        description: cook.description,
        features: cook.features,
      });
      setSelectedFeatures(cook.features);
    }
  }, [cook, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return apiRequest("PATCH", `/api/admin/cooks/${cookId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cooks"] });
      toast({
        title: "Success",
        description: "Chef updated successfully",
      });
      setLocation("/admin/listings");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update chef",
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

  if (!cook) {
    return (
      <AdminLayout>
        <div className="p-8">
          <p>Chef not found</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-semibold mb-2">Edit Personal Chef</h1>
          <p className="text-muted-foreground">
            Update personal chef listing details
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Chef Details</CardTitle>
            <CardDescription>
              Modify the fields you want to update
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

                <div className="grid grid-cols-2 gap-4">
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

                  <FormField
                    control={form.control}
                    name="pricePerSession"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Price per Session</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="1"
                            placeholder="150"
                            {...field}
                            data-testid="input-cook-price-per-session"
                          />
                        </FormControl>
                        <FormDescription>USD per cooking session</FormDescription>
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
                      <FormLabel>Image URL (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          type="url"
                          placeholder="https://example.com/image.jpg"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-cook-image-url"
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
                          placeholder="Describe the chef's experience and services..."
                          rows={4}
                          {...field}
                          data-testid="input-cook-description"
                        />
                      </FormControl>
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
                    disabled={updateMutation.isPending}
                    data-testid="button-submit-cook"
                  >
                    {updateMutation.isPending ? "Updating..." : "Update Chef"}
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
