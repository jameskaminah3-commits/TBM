import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AdminLayout } from "@/components/admin-layout";
import { AdminMediaField } from "@/components/admin-media-field";
import { ExperienceAddonEditor } from "@/components/experience-addon-editor";
import { ExperienceDepartureEditor } from "@/components/experience-departure-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertExperienceSchema, type Experience, type ProviderAccountSummary } from "@shared/schema";

const featureOptions = [
  "Private",
  "Family Friendly",
  "Couples",
  "Sunset Timing",
  "Transport Optional",
  "Photography Friendly",
  "Food Included",
  "Local Host",
];

const formSchema = insertExperienceSchema.extend({
  price: z.coerce.number().min(0),
  durationHours: z.coerce.number().min(1, "Duration must be at least 1 hour"),
  minGuests: z.coerce.number().min(1, "Display minimum guests must be at least 1"),
  maxGuests: z.coerce.number().min(1, "Private max group size must be at least 1"),
  privatePricePerPerson: z.coerce.number().min(0),
  privateMinimumGuests: z.coerce.number().min(2),
  sharedPricePerPerson: z.coerce.number().min(0),
  sharedMinimumGuests: z.coerce.number().min(1),
  sharedMaxCapacity: z.coerce.number().min(1),
  managerUserId: z.string().optional(),
  inclusionsText: z.string().optional(),
  exclusionsText: z.string().optional(),
}).superRefine((value, ctx) => {
  if (!value.privateEnabled && !value.sharedEnabled) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["privateEnabled"], message: "Enable at least one booking option" });
  }
  if (value.maxGuests < value.minGuests) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxGuests"], message: "Private max group size must be greater than or equal to the display minimum guests" });
  }
  if (value.privateEnabled && value.privatePricePerPerson <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["privatePricePerPerson"], message: "Private experiences need a price per person" });
  }
  if (value.sharedEnabled && value.sharedPricePerPerson <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sharedPricePerPerson"], message: "Shared experiences need a price per person" });
  }
  if (value.sharedEnabled && value.sharedMaxCapacity < value.sharedMinimumGuests) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sharedMaxCapacity"], message: "Shared capacity must be greater than or equal to the minimum guests needed to run" });
  }
  if (value.sharedEnabled && (value.sharedDepartures?.length ?? 0) === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sharedDepartures"], message: "Add at least one shared departure" });
  }
});

type FormData = z.infer<typeof formSchema>;

function splitLines(value?: string) {
  return (value || "").split("\n").map((item) => item.trim()).filter(Boolean);
}

export default function AdminExperiencesEdit() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const { data: providers = [] } = useQuery<ProviderAccountSummary[]>({
    queryKey: ["/api/admin/provider-accounts"],
  });
  const { data: experience, isLoading } = useQuery<Experience>({
    queryKey: ["/api/admin/experiences", id],
    enabled: !!id,
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      location: "",
      experienceLocation: "",
      experienceType: "Curated experience",
      price: 0,
      durationHours: 3,
      minGuests: 2,
      maxGuests: 8,
      meetingPoint: "",
      inclusions: [],
      exclusions: [],
      inclusionsText: "",
      exclusionsText: "",
      customQuoteEnabled: false,
      privateEnabled: true,
      sharedEnabled: false,
      privatePricePerPerson: 0,
      privateMinimumGuests: 2,
      privateAddons: [],
      sharedPricePerPerson: 0,
      sharedMinimumGuests: 4,
      sharedMaxCapacity: 10,
      sharedAddons: [],
      sharedDepartures: [],
      imageUrl: "",
      galleryUrls: [],
      mediaType: "image",
      isPublic: false,
      managerUserId: "unassigned",
      description: "",
      features: [],
    },
  });

  useEffect(() => {
    if (!experience) return;
    form.reset({
      ...experience,
      managerUserId: experience.managerUserId ?? "unassigned",
      meetingPoint: experience.meetingPoint ?? "",
      inclusionsText: experience.inclusions.join("\n"),
      exclusionsText: experience.exclusions.join("\n"),
      privateAddons: experience.privateAddons || [],
      sharedAddons: experience.sharedAddons || [],
      sharedDepartures: experience.sharedDepartures || [],
    });
    setSelectedFeatures(experience.features || []);
  }, [experience, form]);

  const mutation = useMutation({
    mutationFn: async (data: FormData) => apiRequest("PATCH", `/api/admin/experiences/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/experiences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/experiences", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/experiences"] });
      toast({ title: "Experience updated", description: "The experience listing was updated." });
      setLocation("/admin/listings");
    },
    onError: (error: Error) => {
      toast({ title: "Could not update experience", description: error.message.replace(/^\d+:\s*/, ""), variant: "destructive" });
    },
  });

  const onSubmit = async (data: FormData) => {
    await mutation.mutateAsync({
      ...data,
      managerUserId: data.managerUserId === "unassigned" ? undefined : data.managerUserId,
      inclusions: splitLines(data.inclusionsText),
      exclusions: splitLines(data.exclusionsText),
      features: selectedFeatures,
    });
  };

  if (isLoading) {
    return <AdminLayout><div className="p-8">Loading...</div></AdminLayout>;
  }

  const privateEnabled = form.watch("privateEnabled");
  const sharedEnabled = form.watch("sharedEnabled");

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl p-8">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-serif font-semibold">Edit Experience</h1>
          <p className="text-muted-foreground">Update the private and shared booking setup for this experience.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Experience Details</CardTitle>
            <CardDescription>Refine the story, pricing structure, departures, and guest fit.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                <FormField control={form.control} name="title" render={({ field }) => (
                  <FormItem><FormLabel>Title</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="grid gap-4 md:grid-cols-3">
                  <FormField control={form.control} name="location" render={({ field }) => (
                    <FormItem><FormLabel>Provider Base Location</FormLabel><FormControl><Input {...field} /></FormControl><FormDescription>Where the host or provider is based.</FormDescription><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="experienceLocation" render={({ field }) => (
                    <FormItem><FormLabel>Experience Destination</FormLabel><FormControl><Input {...field} /></FormControl><FormDescription>Where the experience actually happens.</FormDescription><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="experienceType" render={({ field }) => (
                    <FormItem><FormLabel>Experience Type</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="managerUserId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assigned Provider</FormLabel>
                    <Select value={field.value ?? "unassigned"} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Assign a provider" /></SelectTrigger></FormControl>
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
                )} />

                <div className="grid gap-4 md:grid-cols-3">
                  <FormField control={form.control} name="durationHours" render={({ field }) => (
                    <FormItem><FormLabel>Duration (Hours)</FormLabel><FormControl><Input type="number" min="1" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="minGuests" render={({ field }) => (
                    <FormItem><FormLabel>Display Min Guests</FormLabel><FormControl><Input type="number" min="1" {...field} /></FormControl><FormDescription>Shown on cards as a quick guide.</FormDescription><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="maxGuests" render={({ field }) => (
                    <FormItem><FormLabel>Private Max Group Size</FormLabel><FormControl><Input type="number" min="1" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="meetingPoint" render={({ field }) => (
                  <FormItem><FormLabel>Meeting Point</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
                )} />

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField control={form.control} name="privateEnabled" render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div><FormLabel>Private experience</FormLabel><FormDescription>Flexible date for one private group only.</FormDescription></div>
                      <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="sharedEnabled" render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div><FormLabel>Shared group experience</FormLabel><FormDescription>Fixed departures with limited seats.</FormDescription></div>
                      <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                </div>

                {privateEnabled ? (
                  <div className="space-y-4 rounded-xl border p-5">
                    <div>
                      <h3 className="font-medium">Private Booking Setup</h3>
                      <p className="text-sm text-muted-foreground">Guests choose their own date and book for their own couple, family, or friend group.</p>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField control={form.control} name="privatePricePerPerson" render={({ field }) => (
                        <FormItem><FormLabel>Private Price Per Person (USD)</FormLabel><FormControl><Input type="number" min="0" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="privateMinimumGuests" render={({ field }) => (
                        <FormItem><FormLabel>Private Minimum Guests</FormLabel><FormControl><Input type="number" min="2" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="privateAddons" render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <ExperienceAddonEditor
                            label="Private Add-Ons"
                            description="Optional upgrades for the private group experience."
                            value={Array.from((field.value ?? []) as ArrayLike<{ id: string; name: string; price: number }>)}
                            onChange={field.onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                ) : null}

                {sharedEnabled ? (
                  <div className="space-y-4 rounded-xl border p-5">
                    <div>
                      <h3 className="font-medium">Shared Group Setup</h3>
                      <p className="text-sm text-muted-foreground">Guests join fixed departures, book per person, and share the cost of the trip.</p>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                      <FormField control={form.control} name="sharedPricePerPerson" render={({ field }) => (
                        <FormItem><FormLabel>Shared Price Per Person (USD)</FormLabel><FormControl><Input type="number" min="0" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="sharedMinimumGuests" render={({ field }) => (
                        <FormItem><FormLabel>Minimum Guests To Run</FormLabel><FormControl><Input type="number" min="1" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="sharedMaxCapacity" render={({ field }) => (
                        <FormItem><FormLabel>Shared Max Capacity</FormLabel><FormControl><Input type="number" min="1" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="sharedDepartures" render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <ExperienceDepartureEditor value={Array.from((field.value ?? []) as ArrayLike<{ id: string; date: string; time: string }>)} onChange={field.onChange} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="sharedAddons" render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <ExperienceAddonEditor
                            label="Shared Group Add-Ons"
                            description="Optional extras guests can add when joining the shared departure."
                            value={Array.from((field.value ?? []) as ArrayLike<{ id: string; name: string; price: number }>)}
                            onChange={field.onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                ) : null}

                <FormField control={form.control} name="customQuoteEnabled" render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div><FormLabel>Allow custom quote requests</FormLabel><FormDescription>Keep this on if some guest requests need manual pricing.</FormDescription></div>
                    <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />

                <FormField control={form.control} name="isPublic" render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div><FormLabel>Visibility</FormLabel><FormDescription>Switch this experience between public and private from here.</FormDescription></div>
                    <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />

                <FormField control={form.control} name="imageUrl" render={({ field }) => (
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
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea rows={5} {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField control={form.control} name="inclusionsText" render={({ field }) => (
                    <FormItem><FormLabel>Inclusions</FormLabel><FormControl><Textarea rows={5} {...field} value={field.value ?? ""} /></FormControl><FormDescription>One item per line.</FormDescription><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="exclusionsText" render={({ field }) => (
                    <FormItem><FormLabel>Exclusions</FormLabel><FormControl><Textarea rows={5} {...field} value={field.value ?? ""} /></FormControl><FormDescription>One item per line.</FormDescription><FormMessage /></FormItem>
                  )} />
                </div>
                <div className="space-y-4">
                  <FormLabel>Features</FormLabel>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {featureOptions.map((feature) => (
                      <label key={feature} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                        <Checkbox
                          checked={selectedFeatures.includes(feature)}
                          onCheckedChange={() => {
                            const updated = selectedFeatures.includes(feature)
                              ? selectedFeatures.filter((value) => value !== feature)
                              : [...selectedFeatures, feature];
                            setSelectedFeatures(updated);
                            form.setValue("features", updated);
                          }}
                        />
                        <span>{feature}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex gap-4">
                  <Button type="button" variant="outline" onClick={() => setLocation("/admin/listings")}>Cancel</Button>
                  <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Saving..." : "Save Changes"}</Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
