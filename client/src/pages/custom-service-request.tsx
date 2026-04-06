import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/lib/currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CheckoutPaymentPreview, customRequestCheckoutPreviewCopy } from "@/components/payment-provider-picker";
import { customServiceRequestFeeUsd } from "@shared/custom-service";

const customRequestSchema = z.object({
  serviceCategory: z.enum(["dine", "drive", "errands", "experience", "stay", "other"]),
  description: z.string().min(20, "Please add at least 20 characters so we can help well."),
  preferredDate: z.string().min(1, "Preferred date is required."),
  preferredTime: z.string().optional(),
  peopleCount: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce.number().min(1, "People count must be at least 1").optional(),
  ),
  location: z.string().optional(),
  budgetUsd: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce.number().min(1, "Budget must be at least $1").optional(),
  ),
  listDetails: z.string().optional(),
});

type CustomRequestForm = z.infer<typeof customRequestSchema>;
type CustomRequestCheckoutResponse = {
  payment?: {
    redirectUrl?: string | null;
  } | null;
  warning?: string | null;
};
type CustomRequestSubmission = CustomRequestForm;

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

export default function CustomServiceRequestPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const { selectedCurrency, convertFromUsd, convertToUsd, formatAmount } = useCurrency();
  const [attachment, setAttachment] = useState<File | null>(null);

  const form = useForm<CustomRequestForm>({
    resolver: zodResolver(customRequestSchema),
    defaultValues: {
      serviceCategory: "other",
      description: "",
      preferredDate: "",
      preferredTime: "",
      peopleCount: undefined,
      location: "",
      budgetUsd: undefined,
      listDetails: "",
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const dataUrl = await toDataUrl(file);
      const response = await apiRequest("POST", "/api/custom-service-requests/upload", {
        dataUrl,
        mimeType: file.type,
      });
      return response.json() as Promise<{ mediaUrl: string }>;
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (payload: CustomRequestSubmission) => {
      let attachmentUrl: string | undefined;
      if (attachment) {
        const uploaded = await uploadMutation.mutateAsync(attachment);
        attachmentUrl = uploaded.mediaUrl;
      }

      const response = await apiRequest("POST", "/api/custom-service-requests", {
        ...payload,
        budgetAmount: payload.budgetUsd ? convertFromUsd(payload.budgetUsd, selectedCurrency) : undefined,
        budgetCurrency: payload.budgetUsd ? selectedCurrency : undefined,
        attachmentUrl,
      });
      return response.json() as Promise<CustomRequestCheckoutResponse>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      toast({
        title: "Request submitted",
        description: "We saved it to My Bookings, where you can complete the full payment whenever you're ready.",
      });
      setLocation("/bookings");
    },
    onError: (error: Error) => {
      toast({
        title: "Could not submit request",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const submitDisabled = useMemo(
    () => submitMutation.isPending || uploadMutation.isPending,
    [submitMutation.isPending, uploadMutation.isPending],
  );

  const onSubmit = async (values: CustomRequestForm) => {
    if (!isAuthenticated) {
      setLocation(`/auth?next=${encodeURIComponent("/request-custom-service")}`);
      return;
    }

    await submitMutation.mutateAsync(values);
  };

  return (
    <div className="min-h-screen py-12">
      <div className="container mx-auto max-w-3xl px-4 md:px-8">
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-2xl leading-tight sm:text-3xl">Request a Custom Service</CardTitle>
            <CardDescription>
              Can&apos;t find what you need? No problem.
              <br />
              Tell us what you&apos;re looking for and we&apos;ll create a personalised proposal for your Coast trip.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <FormField
                  control={form.control}
                  name="serviceCategory"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>What service are you looking for?</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-custom-service-category">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="dine">Chef / Dine</SelectItem>
                          <SelectItem value="drive">Drive</SelectItem>
                          <SelectItem value="errands">Errands / Shopping / Laundry / Cleaning</SelectItem>
                          <SelectItem value="experience">Experience</SelectItem>
                          <SelectItem value="stay">Stay-related</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tell us more about your idea</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={5}
                          placeholder="E.g. Romantic sunset dinner with chef, vegan menu for 6, baby items to my Diani villa..."
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="preferredDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Preferred date</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="preferredTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Preferred time (optional)</FormLabel>
                        <FormControl>
                          <Input type="time" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="peopleCount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>People (optional)</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" placeholder="2" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Location (optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="Diani / Nyali / Watamu..." {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="budgetUsd"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{selectedCurrency === "KES" ? "Budget KSh (optional)" : "Budget USD (optional)"}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="1"
                            placeholder={selectedCurrency === "KES" ? "19500" : "150"}
                            value={field.value == null ? "" : String(Math.round(convertFromUsd(field.value, selectedCurrency)))}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              if (nextValue === "") {
                                field.onChange(undefined);
                                return;
                              }
                              const numericValue = Number(nextValue);
                              field.onChange(
                                Number.isFinite(numericValue)
                                  ? convertToUsd(numericValue, selectedCurrency)
                                  : undefined,
                              );
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="listDetails"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>List details (optional)</FormLabel>
                      <FormControl>
                        <Textarea rows={3} placeholder="Paste any specific item or shopping list here if relevant." {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormItem>
                  <FormLabel>Upload reference photo (optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
                    />
                  </FormControl>
                  <FormDescription>
                    Useful for menu inspiration, product references, or setup examples.
                  </FormDescription>
                </FormItem>

                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
                  A small creditable fee applies. It will be fully deducted from your final booking if you accept the proposal.
                </div>

                <CheckoutPaymentPreview
                  title={customRequestCheckoutPreviewCopy.title}
                  description={customRequestCheckoutPreviewCopy.description}
                />

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    className="sm:w-auto"
                    onClick={() => setLocation("/")}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="sm:w-auto"
                    disabled={submitDisabled}
                    data-testid="button-submit-custom-request"
                  >
                    {submitDisabled ? "Submitting request..." : `Submit request (${formatAmount(customServiceRequestFeeUsd)})`}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
