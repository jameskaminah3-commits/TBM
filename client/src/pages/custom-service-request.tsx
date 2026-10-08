import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import {
  ArrowRight,
  Car,
  ChefHat,
  Clock,
  Compass,
  Home,
  ImagePlus,
  MessageSquareText,
  Search,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  ThumbsUp,
  X,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { DatePicker } from "@/components/date-range-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/lib/currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { customServiceRequestFeeUsd } from "@shared/custom-service";

const customRequestCategories = ["stay", "drive", "dine", "errands", "experience", "other"] as const;
type CustomRequestCategory = (typeof customRequestCategories)[number];

const customRequestSchema = z.object({
  serviceCategory: z.enum(customRequestCategories, { errorMap: () => ({ message: "Choose what it's for." }) }),
  description: z.string().trim().min(20, "Add a little more so we can find the right thing (20 characters at least)."),
  preferredDate: z.string().min(1, "Pick a date. A rough one is fine."),
  preferredTime: z.string().optional(),
  peopleCount: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce.number().min(1, "At least 1 person").optional(),
  ),
  location: z.string().optional(),
  budgetUsd: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce.number().min(1, "Enter a budget above zero, or leave it empty").optional(),
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

const categoryOptions: { value: CustomRequestCategory; label: string; icon: typeof Home }[] = [
  { value: "stay", label: "A stay", icon: Home },
  { value: "drive", label: "A ride", icon: Car },
  { value: "dine", label: "A chef", icon: ChefHat },
  { value: "errands", label: "Help at your stay", icon: ShoppingBasket },
  { value: "experience", label: "A day out", icon: Compass },
  { value: "other", label: "Something else", icon: Sparkles },
];

// Starting points a guest can tap and then edit. Each also picks the
// category, unless the guest has already chosen one.
const requestExamples: { label: string; text: string; category: CustomRequestCategory }[] = [
  {
    label: "Birthday dinner at the villa",
    text: "A private chef for a birthday dinner for 8 at our villa in Diani. Seafood, and one guest is vegetarian.",
    category: "dine",
  },
  {
    label: "Groceries before we land",
    text: "Groceries, drinks and nappies waiting at our apartment in Nyali when we land on Friday evening.",
    category: "errands",
  },
  {
    label: "A driver for 4 days",
    text: "A driver for 4 days: the airport pickup, then day trips to Watamu and Malindi.",
    category: "drive",
  },
  {
    label: "A beach house for December",
    text: "A 3-bedroom house near the beach in Nyali for two weeks in December, around KSh 15,000 a night.",
    category: "stay",
  },
];

// The links that send guests here say which page they came from, so the
// request starts on the right kind of thing.
const categoryBySourcePrefix: Record<string, CustomRequestCategory> = {
  stay: "stay",
  drive: "drive",
  dine: "dine",
  relax: "errands",
  experience: "experience",
};

const draftStorageKey = "tbm-custom-request-draft";
const maxPhotoBytes = 8 * 1024 * 1024;
const photoTypes = ["image/jpeg", "image/png", "image/webp"];

function categoryFromSearch(search: string): CustomRequestCategory | undefined {
  const params = new URLSearchParams(search);
  const category = params.get("category");
  if (category && (customRequestCategories as readonly string[]).includes(category)) {
    return category as CustomRequestCategory;
  }
  const prefix = params.get("source")?.split("-")[0] ?? "";
  return categoryBySourcePrefix[prefix];
}

// What a signed-out guest typed is kept while they sign in, so they come back
// to their request rather than an empty form.
function readDraft(): Partial<CustomRequestForm> | null {
  try {
    const raw = window.sessionStorage.getItem(draftStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function saveDraft(values: CustomRequestForm) {
  try {
    window.sessionStorage.setItem(draftStorageKey, JSON.stringify(values));
  } catch {
    // Storage can be off; the guest then types the request again.
  }
}

function clearDraft() {
  try {
    window.sessionStorage.removeItem(draftStorageKey);
  } catch {
    // Nothing was stored.
  }
}

function formatFileSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

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
  const search = useSearch();
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { selectedCurrency, convertFromUsd, convertToUsd, formatAmount } = useCurrency();
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [draft] = useState(readDraft);
  const fee = formatAmount(customServiceRequestFeeUsd);

  const form = useForm<CustomRequestForm>({
    resolver: zodResolver(customRequestSchema),
    defaultValues: {
      serviceCategory: categoryFromSearch(search),
      description: "",
      preferredDate: "",
      preferredTime: "",
      peopleCount: undefined,
      location: "",
      budgetUsd: undefined,
      listDetails: "",
      ...draft,
    },
  });

  useEffect(() => {
    clearDraft();
  }, []);

  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!attachment) {
      setAttachmentPreview(null);
      return;
    }
    const url = URL.createObjectURL(attachment);
    setAttachmentPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment]);

  const description = form.watch("description");
  const showExamples = !description?.trim() || requestExamples.some((example) => example.text === description);

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
        title: "Request sent",
        description: `It's in My Bookings, where you can pay the ${fee} request fee and see our reply.`,
      });
      setLocation("/bookings");
    },
    onError: (error: Error) => {
      toast({
        title: "We couldn't send your request",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const submitDisabled = submitMutation.isPending || uploadMutation.isPending;

  const onSubmit = async (values: CustomRequestForm) => {
    if (!isAuthenticated) {
      saveDraft(values);
      setLocation(`/auth?next=${encodeURIComponent("/request-custom-service")}`);
      return;
    }

    await submitMutation.mutateAsync(values);
  };

  const chooseExample = (example: (typeof requestExamples)[number]) => {
    form.setValue("description", example.text, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    if (!form.getValues("serviceCategory")) {
      form.setValue("serviceCategory", example.category, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    }
    form.setFocus("description");
  };

  const choosePhoto = (file: File | null) => {
    if (!file) return;
    if (!photoTypes.includes(file.type)) {
      setAttachmentError("Choose a JPG, PNG or WEBP photo.");
      return;
    }
    if (file.size > maxPhotoBytes) {
      setAttachmentError(`That photo is ${formatFileSize(file.size)}. Choose one under 8 MB.`);
      return;
    }
    setAttachmentError(null);
    setAttachment(file);
  };

  const steps = [
    {
      icon: MessageSquareText,
      title: "Tell us",
      body: "What you need, when, and your budget. A photo helps.",
    },
    {
      icon: Search,
      title: "We find it",
      body: "Our team looks along the Coast, checks it, and sends you a proposal with the price in My Bookings.",
    },
    {
      icon: ThumbsUp,
      title: "You decide",
      body: `Accept it and book, or say no. If you accept, the ${fee} request fee comes off the price.`,
    },
  ];

  return (
    <div className="pb-16">
      <section className="border-b border-border/60 bg-muted/30">
        <div className="container mx-auto max-w-3xl px-4 py-10 md:px-8 md:py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Custom request</p>
          <h1 className="mt-3 font-serif text-[2rem] font-medium leading-[1.1] text-foreground sm:text-5xl">
            Tell us what you need
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Can&apos;t find it on the site? Describe it and your budget. If it isn&apos;t listed, our team finds it along the Coast and checks it before you pay.
          </p>

          <h2 className="sr-only">How it works</h2>
          <ol className="mt-7 grid gap-2.5 sm:grid-cols-3 sm:gap-3">
            {steps.map(({ icon: Icon, title, body }, index) => (
              <li key={title} className="flex gap-3 rounded-[1.25rem] border border-border/70 bg-card p-4 sm:flex-col">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h3 className="font-semibold text-foreground">
                    <span className="text-muted-foreground">{index + 1}.</span> {title}
                  </h3>
                  <p className="mt-0.5 text-sm leading-6 text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ol>

          <p className="mt-6 flex items-start gap-2.5 text-sm leading-6 text-foreground/85" data-testid="text-custom-reply-time">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            Our team replies within a few hours, Monday to Saturday, 8am to 8pm. Zaina answers any time.
          </p>
          <Link
            href="/verify"
            className="mt-3 flex items-start gap-2.5 text-sm leading-6 text-foreground/85 hover:text-foreground"
            data-testid="link-custom-request-verify"
          >
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>
              Found a place somewhere else and want it checked before you pay?{" "}
              <span className="inline-flex items-center gap-1 font-medium text-primary">
                Verify a listing <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </span>
          </Link>
        </div>
      </section>

      <div className="container mx-auto max-w-3xl px-4 py-10 md:px-8">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-7" aria-labelledby="custom-request-form-heading" noValidate>
            <h2 id="custom-request-form-heading" className="font-serif text-2xl font-medium text-foreground sm:text-3xl">
              Your request
            </h2>

            <FormField
              control={form.control}
              name="serviceCategory"
              render={({ field }) => (
                <FormItem>
                  <FormLabel id="custom-category-label" className="text-base">What&apos;s it for?</FormLabel>
                  <FormControl>
                    <RadioGroupPrimitive.Root
                      ref={field.ref}
                      value={field.value ?? ""}
                      onValueChange={(value) => field.onChange(value as CustomRequestCategory)}
                      aria-labelledby="custom-category-label"
                      className="flex flex-wrap gap-2"
                    >
                      {categoryOptions.map(({ value, label, icon: Icon }) => (
                        <RadioGroupPrimitive.Item
                          key={value}
                          value={value}
                          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border/80 bg-card px-4 text-sm font-medium text-foreground/85 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                          data-testid={`button-custom-category-${value}`}
                        >
                          <Icon className="h-4 w-4" aria-hidden="true" />
                          {label}
                        </RadioGroupPrimitive.Item>
                      ))}
                    </RadioGroupPrimitive.Root>
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
                  <FormLabel className="text-base">What do you need?</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={5}
                      placeholder="What, for how many people, and anything we should know."
                      className="text-base sm:text-sm"
                      data-testid="input-custom-description"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                  {showExamples ? (
                    <div className="pt-1">
                      <p className="text-sm text-muted-foreground">Not sure how to put it? Start from one of these:</p>
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {requestExamples.map((example) => (
                          <li key={example.label}>
                            <button
                              type="button"
                              onClick={() => chooseExample(example)}
                              className="min-h-11 rounded-full border border-dashed border-primary/40 bg-primary/5 px-3.5 text-sm text-foreground/85 transition-colors hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              data-testid={`button-custom-example-${example.category}`}
                            >
                              {example.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </FormItem>
              )}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="preferredDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>When?</FormLabel>
                    <FormControl>
                      <DatePicker value={field.value || ""} onChange={field.onChange} label="When do you need it?" placeholder="Pick a date" data-testid="input-custom-date" />
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
                    <FormLabel>Time (optional)</FormLabel>
                    <FormControl>
                      <Input type="time" className="h-11" {...field} value={field.value || ""} />
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
                      <Input type="number" inputMode="numeric" min="1" placeholder="2" className="h-11" {...field} value={field.value ?? ""} />
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
                    <FormLabel>Where (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Diani, Nyali, Watamu…" className="h-11" {...field} value={field.value || ""} />
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
                    <FormLabel>{selectedCurrency === "KES" ? "Budget in KSh (optional)" : "Budget in US$ (optional)"}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        placeholder={selectedCurrency === "KES" ? "19500" : "150"}
                        className="h-11"
                        name={field.name}
                        onBlur={field.onBlur}
                        ref={field.ref}
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
                  <FormLabel>A list, if you have one (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="A shopping list, a menu, the things you need." {...field} value={field.value || ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div>
              <p id="custom-photo-label" className="text-sm font-medium leading-none">A photo (optional)</p>
              <p className="mt-2 text-sm text-muted-foreground">A menu you liked, a product, a setup you saw.</p>
              {attachment ? (
                <div className="mt-3 flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3" data-testid="custom-attachment">
                  {attachmentPreview ? (
                    <img src={attachmentPreview} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground" data-testid="text-custom-attachment-name">{attachment.name}</p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(attachment.size)}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 shrink-0 rounded-full"
                    onClick={() => setAttachment(null)}
                    aria-label={`Remove ${attachment.name}`}
                    data-testid="button-custom-attachment-remove"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <label className="mt-3 flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-border bg-muted/20 px-4 py-6 text-center transition-colors focus-within:ring-2 focus-within:ring-ring hover:border-primary/50">
                  <ImagePlus className="h-6 w-6 text-primary" aria-hidden="true" />
                  <span className="text-sm font-medium text-foreground">Add a photo</span>
                  <span className="text-xs text-muted-foreground">JPG, PNG or WEBP, up to 8 MB</span>
                  <input
                    type="file"
                    accept={photoTypes.join(",")}
                    className="sr-only"
                    aria-labelledby="custom-photo-label"
                    onChange={(event) => {
                      choosePhoto(event.target.files?.[0] ?? null);
                      event.target.value = "";
                    }}
                    data-testid="input-custom-attachment"
                  />
                </label>
              )}
              {attachmentError ? (
                <p className="mt-2 text-sm font-medium text-destructive" role="alert">{attachmentError}</p>
              ) : null}
            </div>

            <div className="rounded-[1.25rem] border border-primary/20 bg-primary/5 p-4 text-sm leading-6 text-foreground/85" data-testid="text-custom-fee">
              <p className="font-semibold text-foreground">Sending a request costs {fee}</p>
              <p className="mt-1">
                You pay it in My Bookings, by M-Pesa or card. If you accept our proposal, the {fee} comes off the price. If you don&apos;t, there&apos;s nothing more to pay.
              </p>
            </div>

            <div className="space-y-3">
              {!authLoading && !isAuthenticated ? (
                <p className="text-sm text-muted-foreground" data-testid="text-custom-sign-in-note">
                  You&apos;ll sign in before it sends. We keep what you&apos;ve typed.
                </p>
              ) : null}
              <Button
                type="submit"
                size="lg"
                className="h-12 w-full rounded-full px-8 text-base sm:w-auto"
                disabled={submitDisabled}
                data-testid="button-submit-custom-request"
              >
                {submitDisabled ? "Sending your request…" : "Send request"}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
