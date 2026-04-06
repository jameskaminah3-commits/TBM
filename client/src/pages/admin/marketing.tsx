import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { useForm, type FieldErrors } from "react-hook-form";
import { Link, useLocation } from "wouter";
import { z } from "zod";
import {
  insertMarketingPromoSchema,
  marketingPromoChannels,
  marketingPromoCostAbsorptions,
  marketingPromoStatuses,
  marketingPromoTypes,
  providerCategories,
  type BlogPost,
  type MarketingAttributionSummary,
  type MarketingPromo,
  type MarketingPromoChannel,
  type MarketingPromoCostAbsorption,
  type MarketingPromoStatus,
  type MarketingPromoType,
  type PopularService,
  type ProviderCategory,
  type RevenueByMonth,
} from "@shared/schema";
import { AdminLayout } from "@/components/admin-layout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useCurrency, type CurrencyCode } from "@/lib/currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  CalendarClock,
  Copy,
  Edit,
  Globe,
  Megaphone,
  Package2,
  Plus,
  Search,
  Sparkles,
  Target,
  TicketPercent,
  TimerReset,
  Trash2,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

type MarketingPromoFormData = z.infer<typeof insertMarketingPromoSchema>;
type PromoStatusFilter = "all" | MarketingPromoStatus;
type PromoTypeFilter = "all" | MarketingPromoType;
type PromoChannelFilter = "all" | MarketingPromoChannel;

const promoTypeLabels: Record<MarketingPromoType, string> = {
  percent: "Percent off",
  fixed: "Fixed amount",
  bundle: "Bundle promo",
};

const promoChannelLabels: Record<MarketingPromoChannel, string> = {
  homepage: "Homepage",
  blog: "Blog",
  email: "Email",
  social: "Social",
  whatsapp: "WhatsApp",
  partner: "Partner",
};

const promoCostAbsorptionLabels: Record<MarketingPromoCostAbsorption, string> = {
  shared: "Shared",
  partner: "Partner only",
  platform: "Platform only",
};

const promoCostAbsorptionDescriptions: Record<MarketingPromoCostAbsorption, string> = {
  shared: "Discount reduces both platform commission and partner payout proportionally.",
  partner: "Partner absorbs the discount and the platform commission stays protected where booking revenue allows.",
  platform: "Platform absorbs the discount and partner payout stays protected, even if platform net drops.",
};

const providerCategoryLabels: Record<ProviderCategory, string> = {
  stays: "Stays",
  cars: "Cars",
  cooks: "Cooks",
  errands: "Errands",
  experiences: "Experiences",
};

function formatDateLabel(value: string | null | undefined) {
  if (!value) {
    return "No date set";
  }

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-KE", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMonthLabel(value: string) {
  const parsed = new Date(`${value}-01T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-KE", {
    month: "short",
  });
}

function formatPromoWindow(promo: MarketingPromo) {
  if (!promo.startAt && !promo.endAt) {
    return "No schedule";
  }

  if (promo.startAt && promo.endAt) {
    return `${formatDateLabel(promo.startAt)} to ${formatDateLabel(promo.endAt)}`;
  }

  if (promo.startAt) {
    return `Starts ${formatDateLabel(promo.startAt)}`;
  }

  return `Ends ${formatDateLabel(promo.endAt)}`;
}

function formatPromoOffer(promo: MarketingPromo, formatAmount: (amount: number) => string) {
  if (promo.promoType === "percent") {
    return `${promo.discountPercent ?? 0}% off`;
  }

  if (promo.promoType === "bundle") {
    return `${promo.bundleLabel || "Bundle"} - ${formatAmount(promo.discountAmount ?? 0)} off`;
  }

  return `${formatAmount(promo.discountAmount ?? 0)} off`;
}

function getPromoCostAbsorptionValue(value: string | null | undefined): MarketingPromoCostAbsorption {
  return marketingPromoCostAbsorptions.includes(value as MarketingPromoCostAbsorption)
    ? value as MarketingPromoCostAbsorption
    : "shared";
}

function getPromoStatusTone(status: string) {
  switch (status) {
    case "active":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "scheduled":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "paused":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "expired":
      return "border-stone-200 bg-stone-100 text-stone-700";
    case "draft":
    default:
      return "border-rose-200 bg-rose-50 text-rose-900";
  }
}

function getPromoTypeTone(type: string) {
  switch (type) {
    case "percent":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "bundle":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "fixed":
    default:
      return "border-stone-200 bg-stone-100 text-stone-700";
  }
}

function getUsageProgress(promo: MarketingPromo) {
  if (!promo.usageLimit || promo.usageLimit <= 0) {
    return null;
  }

  return Math.max(0, Math.min(100, (promo.redemptionCount / promo.usageLimit) * 100));
}

function isSeoReady(post: BlogPost) {
  return Boolean(post.seoTitle?.trim() && post.seoDescription?.trim() && post.featuredImageAlt?.trim());
}

function isStalePost(post: BlogPost) {
  const sourceDate = post.publishedAt || post.updatedAt || post.createdAt;
  const parsed = new Date(sourceDate);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
  return Date.now() - parsed.getTime() > sixtyDaysMs;
}

function normalizeDateInput(value: string | null | undefined) {
  return value ?? "";
}

function formatIntegerInputValue(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

function parseOptionalIntegerInput(value: string) {
  const digitsOnly = value.replace(/[^\d]/g, "");
  return digitsOnly.length > 0 ? Number(digitsOnly) : null;
}

function parseIntegerInputWithFallback(value: string, fallback = 0) {
  const parsed = parseOptionalIntegerInput(value);
  return parsed ?? fallback;
}

function parseOptionalPercentInput(value: string) {
  const parsed = parseOptionalIntegerInput(value);
  return parsed == null ? null : Math.min(parsed, 100);
}

function getFirstFormErrorMessage(errors: FieldErrors<MarketingPromoFormData>): string | null {
  for (const value of Object.values(errors)) {
    if (!value) {
      continue;
    }

    if (typeof value === "object" && "message" in value && typeof value.message === "string" && value.message.length > 0) {
      return value.message;
    }

    if (typeof value === "object") {
      const nestedMessage = getFirstFormErrorMessage(value as FieldErrors<MarketingPromoFormData>);
      if (nestedMessage) {
        return nestedMessage;
      }
    }
  }

  return null;
}

function convertStoredAmountToDisplayValue(
  amount: number,
  currency: CurrencyCode,
  usdToKes: number,
) {
  return currency === "KES" ? Math.round(amount * usdToKes) : amount;
}

function convertDisplayAmountToStoredValue(
  amount: number | null | undefined,
  currency: CurrencyCode,
  usdToKes: number,
) {
  if (amount == null) {
    return null;
  }

  if (currency === "USD") {
    return amount;
  }

  if (amount <= 0) {
    return 0;
  }

  return Math.max(1, Math.round(amount / usdToKes));
}

function convertDisplayAmountBetweenCurrencies(
  amount: number | null | undefined,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  usdToKes: number,
) {
  if (amount == null || fromCurrency === toCurrency) {
    return amount ?? null;
  }

  const storedValue = convertDisplayAmountToStoredValue(amount, fromCurrency, usdToKes);
  if (storedValue == null) {
    return null;
  }

  return convertStoredAmountToDisplayValue(storedValue, toCurrency, usdToKes);
}

function getPromoFormDefaults(
  promo: MarketingPromo | undefined,
  currency: CurrencyCode,
  usdToKes: number,
): MarketingPromoFormData {
  return {
    name: promo?.name ?? "",
    code: promo?.code ?? null,
    description: promo?.description ?? null,
    promoType: (promo?.promoType as MarketingPromoType | undefined) ?? "percent",
    costAbsorption: getPromoCostAbsorptionValue(promo?.costAbsorption),
    status: (promo?.status as MarketingPromoStatus | undefined) ?? "draft",
    channel: (promo?.channel as MarketingPromoChannel | undefined) ?? "homepage",
    audience: promo?.audience ?? null,
    eligibleCategories: (promo?.eligibleCategories as ProviderCategory[] | undefined) ?? [],
    bundleLabel: promo?.bundleLabel ?? null,
    discountPercent: promo?.discountPercent ?? null,
    discountAmount: promo?.discountAmount == null ? null : convertStoredAmountToDisplayValue(promo.discountAmount, currency, usdToKes),
    minimumSpend: promo?.minimumSpend == null ? null : convertStoredAmountToDisplayValue(promo.minimumSpend, currency, usdToKes),
    usageLimit: promo?.usageLimit ?? null,
    redemptionCount: promo?.redemptionCount ?? 0,
    attributedRevenue: convertStoredAmountToDisplayValue(promo?.attributedRevenue ?? 0, currency, usdToKes),
    landingPath: promo?.landingPath ?? null,
    startAt: promo?.startAt ?? null,
    endAt: promo?.endAt ?? null,
    autoApply: promo?.autoApply ?? false,
    requiredCategories: (promo?.requiredCategories as ProviderCategory[] | undefined) ?? [],
    minimumNights: promo?.minimumNights ?? null,
    minimumGuests: promo?.minimumGuests ?? null,
    minimumServiceCount: promo?.minimumServiceCount ?? null,
    notes: promo?.notes ?? null,
  };
}

function SummaryCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  description?: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {title}
            </div>
            <div className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{value}</div>
          </div>
          <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-stone-200/80 bg-stone-50 text-stone-700 sm:flex">
            <Icon className="h-4 w-4" />
          </div>
        </div>
        {description ? <p className="mt-3 text-sm leading-5 text-muted-foreground">{description}</p> : null}
      </CardContent>
    </Card>
  );
}

function MarketingSkeleton() {
  return (
    <div className="space-y-5">
      <Card className="border-stone-200/80 bg-white shadow-sm">
        <CardContent className="space-y-4 p-5 sm:p-6">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-4 w-full max-w-2xl" />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Skeleton className="h-10 w-full sm:w-40" />
            <Skeleton className="h-10 w-full sm:w-40" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PromoForm({
  promo,
  onSuccess,
}: {
  promo?: MarketingPromo;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const { selectedCurrency, usdToKes } = useCurrency();
  const isEditing = Boolean(promo);
  const amountCurrencyLabel = selectedCurrency === "KES" ? "KES" : "USD";
  const promoResetKey = promo?.id ?? "__create__";
  const initialPromoDefaults = useMemo(
    () => getPromoFormDefaults(promo, selectedCurrency, usdToKes),
    [promo, selectedCurrency, usdToKes],
  );
  const previousCurrencyRef = useRef<CurrencyCode>(selectedCurrency);
  const previousPromoKeyRef = useRef(promoResetKey);
  const [discountAmountInput, setDiscountAmountInput] = useState(
    formatIntegerInputValue(initialPromoDefaults.discountAmount),
  );

  const form = useForm<MarketingPromoFormData>({
    resolver: zodResolver(insertMarketingPromoSchema),
    defaultValues: initialPromoDefaults,
  });

  useEffect(() => {
    if (previousPromoKeyRef.current !== promoResetKey) {
      const nextDefaults = getPromoFormDefaults(promo, selectedCurrency, usdToKes);
      form.reset(nextDefaults);
      setDiscountAmountInput(formatIntegerInputValue(nextDefaults.discountAmount));
      previousPromoKeyRef.current = promoResetKey;
      previousCurrencyRef.current = selectedCurrency;
      return;
    }

    if (previousCurrencyRef.current !== selectedCurrency) {
      const previousCurrency = previousCurrencyRef.current;
      const currentValues = form.getValues();
      form.setValue(
        "discountAmount",
        convertDisplayAmountBetweenCurrencies(currentValues.discountAmount, previousCurrency, selectedCurrency, usdToKes),
        { shouldDirty: true },
      );
      setDiscountAmountInput(
        formatIntegerInputValue(
          convertDisplayAmountBetweenCurrencies(currentValues.discountAmount, previousCurrency, selectedCurrency, usdToKes),
        ),
      );
      form.setValue(
        "minimumSpend",
        convertDisplayAmountBetweenCurrencies(currentValues.minimumSpend, previousCurrency, selectedCurrency, usdToKes),
        { shouldDirty: true },
      );
      form.setValue(
        "attributedRevenue",
        convertDisplayAmountBetweenCurrencies(currentValues.attributedRevenue, previousCurrency, selectedCurrency, usdToKes) ?? 0,
        { shouldDirty: true },
      );
      previousCurrencyRef.current = selectedCurrency;
    }
  }, [form, promo, promoResetKey, selectedCurrency, usdToKes]);

  const promoType = form.watch("promoType");

  const createMutation = useMutation({
    mutationFn: async (data: MarketingPromoFormData) => await apiRequest("POST", "/api/admin/marketing/promos", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/marketing/promos"] });
      toast({ title: "Promo created", description: "The campaign is now ready in your marketing queue." });
      onSuccess();
    },
    onError: (error: Error) => toast({ title: "Could not create promo", description: error.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: MarketingPromoFormData) => await apiRequest("PATCH", `/api/admin/marketing/promos/${promo?.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/marketing/promos"] });
      toast({ title: "Promo updated", description: "Marketing details were saved." });
      onSuccess();
    },
    onError: (error: Error) => toast({ title: "Could not update promo", description: error.message, variant: "destructive" }),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Form {...form}>
      <form
        className="space-y-4 sm:space-y-5"
        onSubmit={form.handleSubmit(
          (values) => {
            const payload: MarketingPromoFormData = {
              ...values,
              discountAmount: convertDisplayAmountToStoredValue(values.discountAmount, selectedCurrency, usdToKes),
              minimumSpend: convertDisplayAmountToStoredValue(values.minimumSpend, selectedCurrency, usdToKes),
              attributedRevenue: convertDisplayAmountToStoredValue(values.attributedRevenue, selectedCurrency, usdToKes) ?? 0,
            };

            if (isEditing) {
              updateMutation.mutate(payload);
              return;
            }

            createMutation.mutate(payload);
          },
          (errors) => {
            toast({
              title: "Promo not saved",
              description: getFirstFormErrorMessage(errors) ?? "Please check the highlighted promo fields and try again.",
              variant: "destructive",
            });
          },
        )}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Promo Name</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} placeholder="Weekend Family Bundle" className="text-base sm:text-sm" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Promo Code</FormLabel>
                <FormControl>
                  <Input
                    value={field.value ?? ""}
                    onChange={(event) => field.onChange(event.target.value || null)}
                    placeholder="APRIL-BUNDLE"
                    className="text-base sm:text-sm"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FormField
            control={form.control}
            name="promoType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Promo Type</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="text-base sm:text-sm">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {marketingPromoTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {promoTypeLabels[type]}
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
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="text-base sm:text-sm">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {marketingPromoStatuses.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
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
            name="channel"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Channel</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="text-base sm:text-sm">
                      <SelectValue placeholder="Select channel" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {marketingPromoChannels.map((channel) => (
                      <SelectItem key={channel} value={channel}>
                        {promoChannelLabels[channel]}
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
            name="audience"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Audience</FormLabel>
                <FormControl>
                  <Input
                    value={field.value ?? ""}
                    onChange={(event) => field.onChange(event.target.value || null)}
                    placeholder="Families, short stays, repeat guests"
                    className="text-base sm:text-sm"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Campaign Summary</FormLabel>
              <FormControl>
                <Textarea
                  value={field.value ?? ""}
                  onChange={(event) => field.onChange(event.target.value || null)}
                  rows={3}
                  placeholder="What the offer is for and what success looks like."
                  className="text-base sm:text-sm"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-muted-foreground">
          Amount fields follow your current app currency ({amountCurrencyLabel}) and convert when saved.
        </div>

        <FormField
          control={form.control}
          name="costAbsorption"
          render={({ field }) => {
            const selectedMode = getPromoCostAbsorptionValue(field.value);
            return (
              <FormItem className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
                <FormLabel>Who Absorbs The Promo Cost?</FormLabel>
                <Select value={selectedMode} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="mt-2 text-base sm:text-sm">
                      <SelectValue placeholder="Select funding mode" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {marketingPromoCostAbsorptions.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {promoCostAbsorptionLabels[mode]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription className="leading-6">
                  {promoCostAbsorptionDescriptions[selectedMode]}
                </FormDescription>
                <FormMessage />
              </FormItem>
            );
          }}
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {promoType === "percent" ? (
            <FormField
              control={form.control}
              name="discountPercent"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Discount Percent</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={formatIntegerInputValue(field.value)}
                      onChange={(event) => field.onChange(parseOptionalPercentInput(event.target.value))}
                      placeholder="15"
                      className="text-base sm:text-sm"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : (
            <FormField
              control={form.control}
              name="discountAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Promo Value ({amountCurrencyLabel})</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={discountAmountInput}
                      onChange={(event) => {
                        const nextInput = event.target.value.replace(/[^\d]/g, "");
                        setDiscountAmountInput(nextInput);
                        field.onChange(nextInput === "" ? null : Number(nextInput));
                      }}
                      placeholder="2500"
                      className="text-base sm:text-sm"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="minimumSpend"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Minimum Spend ({amountCurrencyLabel})</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={formatIntegerInputValue(field.value)}
                    onChange={(event) => field.onChange(parseOptionalIntegerInput(event.target.value))}
                    placeholder="5000"
                    className="text-base sm:text-sm"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="usageLimit"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Usage Limit</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={formatIntegerInputValue(field.value)}
                    onChange={(event) => field.onChange(parseOptionalIntegerInput(event.target.value))}
                    placeholder="50"
                    className="text-base sm:text-sm"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="landingPath"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Landing Path</FormLabel>
                <FormControl>
                  <Input
                    value={field.value ?? ""}
                    onChange={(event) => field.onChange(event.target.value || null)}
                    placeholder="/services/experience"
                    className="text-base sm:text-sm"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {promoType === "bundle" ? (
          <FormField
            control={form.control}
            name="bundleLabel"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Bundle Summary</FormLabel>
                <FormControl>
                  <Input
                    value={field.value ?? ""}
                    onChange={(event) => field.onChange(event.target.value || null)}
                    placeholder="Stay + airport transfer + chef breakfast"
                    className="text-base sm:text-sm"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}

        {promoType === "bundle" ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <FormField
                control={form.control}
                name="autoApply"
                render={({ field }) => (
                  <FormItem className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                    <div className="flex items-start gap-3">
                      <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(Boolean(checked))} />
                      <div className="space-y-1">
                        <FormLabel>Auto apply bundle</FormLabel>
                        <p className="text-sm leading-6 text-muted-foreground">
                          Apply this offer automatically when the booking matches the rules.
                        </p>
                      </div>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="minimumNights"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Minimum Nights</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={formatIntegerInputValue(field.value)}
                        onChange={(event) => field.onChange(parseOptionalIntegerInput(event.target.value))}
                        placeholder="2"
                        className="text-base sm:text-sm"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="minimumGuests"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Minimum Guests</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={formatIntegerInputValue(field.value)}
                        onChange={(event) => field.onChange(parseOptionalIntegerInput(event.target.value))}
                        placeholder="2"
                        className="text-base sm:text-sm"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="minimumServiceCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bundled Services</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={formatIntegerInputValue(field.value)}
                        onChange={(event) => field.onChange(parseOptionalIntegerInput(event.target.value))}
                        placeholder="1"
                        className="text-base sm:text-sm"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="requiredCategories"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Required Mix</FormLabel>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    {providerCategories.map((category) => {
                      const checked = (field.value ?? []).includes(category);
                      return (
                        <label
                          key={category}
                          className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3 text-sm text-stone-700"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(nextChecked) => {
                              const nextValue = nextChecked
                                ? Array.from(new Set([...(field.value ?? []), category]))
                                : (field.value ?? []).filter((value) => value !== category);
                              field.onChange(nextValue);
                            }}
                          />
                          <span>{providerCategoryLabels[category]}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Choose the exact stay and service mix required for this bundle.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FormField
            control={form.control}
            name="startAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Start Date</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    value={normalizeDateInput(field.value)}
                    onChange={(event) => field.onChange(event.target.value || null)}
                    className="text-base sm:text-sm"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="endAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>End Date</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    value={normalizeDateInput(field.value)}
                    onChange={(event) => field.onChange(event.target.value || null)}
                    className="text-base sm:text-sm"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="redemptionCount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tracked Redemptions</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={formatIntegerInputValue(field.value)}
                    onChange={(event) => field.onChange(parseIntegerInputWithFallback(event.target.value))}
                    placeholder="0"
                    className="text-base sm:text-sm"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="attributedRevenue"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tracked Revenue ({amountCurrencyLabel})</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={formatIntegerInputValue(field.value)}
                    onChange={(event) => field.onChange(parseIntegerInputWithFallback(event.target.value))}
                    placeholder="0"
                    className="text-base sm:text-sm"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="eligibleCategories"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Service Focus</FormLabel>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {providerCategories.map((category) => {
                  const checked = (field.value ?? []).includes(category);
                  return (
                    <label
                      key={category}
                      className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3 text-sm text-stone-700"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextChecked) => {
                          const nextValue = nextChecked
                            ? Array.from(new Set([...(field.value ?? []), category]))
                            : (field.value ?? []).filter((value) => value !== category);
                          field.onChange(nextValue);
                        }}
                      />
                      <span>{providerCategoryLabels[category]}</span>
                    </label>
                  );
                })}
              </div>
              <p className="text-sm text-muted-foreground">
                Leave this empty if the promo should apply across the whole marketplace.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tracking Notes</FormLabel>
              <FormControl>
                <Textarea
                  value={field.value ?? ""}
                  onChange={(event) => field.onChange(event.target.value || null)}
                  rows={3}
                  placeholder="Owner, success target, or follow-up notes."
                  className="text-base sm:text-sm"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onSuccess} disabled={isPending} className="w-full sm:w-auto">
            Cancel
          </Button>
          <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
            {isPending ? "Saving..." : isEditing ? "Save Changes" : "Create Promo"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export default function AdminMarketing() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { formatAmount } = useCurrency();
  const { isLoading: authLoading, isAdmin } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<PromoStatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<PromoTypeFilter>("all");
  const [channelFilter, setChannelFilter] = useState<PromoChannelFilter>("all");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingPromo, setEditingPromo] = useState<MarketingPromo | null>(null);
  const [promoToDelete, setPromoToDelete] = useState<MarketingPromo | null>(null);

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      setLocation("/auth?next=/admin/marketing");
    }
  }, [authLoading, isAdmin, setLocation]);

  const promosQuery = useQuery<MarketingPromo[]>({
    queryKey: ["/api/admin/marketing/promos"],
    enabled: isAdmin,
  });
  const popularServicesQuery = useQuery<PopularService[]>({
    queryKey: ["/api/admin/analytics/popular-services"],
    enabled: isAdmin,
  });
  const revenueQuery = useQuery<RevenueByMonth[]>({
    queryKey: ["/api/admin/analytics/revenue"],
    enabled: isAdmin,
  });
  const blogQuery = useQuery<BlogPost[]>({
    queryKey: ["/api/admin/blog"],
    enabled: isAdmin,
  });
  const attributionSummaryQuery = useQuery<MarketingAttributionSummary>({
    queryKey: ["/api/admin/marketing/attribution-summary"],
    enabled: isAdmin,
  });

  const deleteMutation = useMutation({
    mutationFn: async (promoId: string) => await apiRequest("DELETE", `/api/admin/marketing/promos/${promoId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/marketing/promos"] });
      toast({ title: "Promo deleted", description: "The campaign was removed from the marketing queue." });
      setPromoToDelete(null);
    },
    onError: (error: Error) => toast({ title: "Could not delete promo", description: error.message, variant: "destructive" }),
  });

  const promos = promosQuery.data ?? [];
  const popularServices = popularServicesQuery.data ?? [];
  const blogPosts = blogQuery.data ?? [];
  const attributionSummary = attributionSummaryQuery.data ?? {
    totalTrackedViews: 0,
    totalTrackedClicks: 0,
    totalAttributedBookings: 0,
    totalAttributedRevenue: 0,
    totalAttributedDiscount: 0,
    topContent: [],
    topPromos: [],
  };

  const promoStudioUnavailable = Boolean(promosQuery.error);
  const popularServicesUnavailable = Boolean(popularServicesQuery.error);
  const revenueUnavailable = Boolean(revenueQuery.error);
  const blogUnavailable = Boolean(blogQuery.error);
  const attributionUnavailable = Boolean(attributionSummaryQuery.error);
  const hasQueryWarnings = promoStudioUnavailable
    || popularServicesUnavailable
    || revenueUnavailable
    || blogUnavailable
    || attributionUnavailable;
  const isLoading = promosQuery.isLoading || popularServicesQuery.isLoading || revenueQuery.isLoading || blogQuery.isLoading || attributionSummaryQuery.isLoading;

  const normalizedQuery = searchTerm.trim().toLowerCase();

  const filteredPromos = useMemo(() => promos.filter((promo) => {
    const matchesSearch = !normalizedQuery || [
      promo.name,
      promo.code ?? "",
      promo.description ?? "",
      promo.audience ?? "",
      promo.landingPath ?? "",
      promo.bundleLabel ?? "",
      promo.notes ?? "",
    ].join(" ").toLowerCase().includes(normalizedQuery);

    const matchesStatus = statusFilter === "all" || promo.status === statusFilter;
    const matchesType = typeFilter === "all" || promo.promoType === typeFilter;
    const matchesChannel = channelFilter === "all" || promo.channel === channelFilter;

    return matchesSearch && matchesStatus && matchesType && matchesChannel;
  }), [channelFilter, normalizedQuery, promos, statusFilter, typeFilter]);

  const promoSummary = useMemo(() => {
    return {
      total: promos.length,
      active: promos.filter((promo) => promo.status === "active").length,
      scheduled: promos.filter((promo) => promo.status === "scheduled").length,
    };
  }, [promos]);

  const blogSummary = useMemo(() => ({
    published: blogPosts.filter((post) => post.status === "published").length,
    drafts: blogPosts.filter((post) => post.status === "draft").length,
    stale: blogPosts.filter((post) => isStalePost(post)).length,
    seoReady: blogPosts.filter((post) => isSeoReady(post)).length,
    withConversionCta: blogPosts.filter((post) => Boolean(post.primaryCtaLabel?.trim() && post.primaryCtaHref?.trim())).length,
    recent: [...blogPosts]
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .slice(0, 4),
  }), [blogPosts]);

  const revenueChartData = useMemo(() => {
    const source = revenueQuery.data ?? [];
    return [...source]
      .sort((left, right) => left.month.localeCompare(right.month))
      .slice(-6)
      .map((point) => ({
        ...point,
        label: formatMonthLabel(point.month),
      }));
  }, [revenueQuery.data]);

  if (authLoading || !isAdmin) {
    return (
      <AdminLayout>
        <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
          <MarketingSkeleton />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="mx-auto flex min-w-0 w-full max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6 lg:gap-6 lg:px-8">
        {isLoading ? <MarketingSkeleton /> : null}

        {!isLoading ? (
          <>
            <Card className="min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm">
              <CardContent className="relative overflow-hidden p-4 sm:p-6 lg:p-7">
                <div className="absolute inset-y-0 right-0 hidden w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.14),transparent_55%),radial-gradient(circle_at_bottom_right,rgba(14,116,144,0.14),transparent_48%)] lg:block" />
                <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="max-w-3xl space-y-3">
                    <Badge variant="outline" className="w-fit rounded-full border-stone-200 bg-stone-50 text-stone-700">
                      Marketing Hub
                    </Badge>
                    <div className="space-y-2">
                      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl" data-testid="heading-marketing">
                        Run promos, track attribution, and keep marketing focused.
                      </h1>
                      <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                        Everything here is built for action: launch offers, review what is converting, and spot the next campaign to tune.
                      </p>
                    </div>
                  </div>

                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                      <DialogTrigger asChild>
                        <Button className="w-full sm:w-auto">
                          <Plus className="h-4 w-4" />
                          New Promo
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-h-[95vh] w-[calc(100vw-1rem)] max-w-5xl overflow-y-auto sm:w-full">
                        <DialogHeader>
                          <DialogTitle>Create Promo</DialogTitle>
                        </DialogHeader>
                        <PromoForm onSuccess={() => setIsCreateDialogOpen(false)} />
                      </DialogContent>
                    </Dialog>

                    <Button asChild variant="outline" className="w-full sm:w-auto">
                      <Link href="/admin/blog">Manage Blog</Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {hasQueryWarnings ? (
              <Card className="min-w-0 overflow-hidden border-amber-200 bg-amber-50 shadow-sm">
                <CardContent className="p-4 sm:p-5">
                  <div className="text-sm font-medium text-amber-950">Some marketing data is unavailable right now.</div>
                  <p className="mt-1 text-sm leading-6 text-amber-900/90">
                    Promos still work. Any panel that needs a retry is called out below.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            <section className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                title="Active Promos"
                value={promoStudioUnavailable ? "Unavailable" : promoSummary.active}
                description="Live offers ready to convert."
                icon={Megaphone}
              />
              <SummaryCard
                title="Attributed Bookings"
                value={attributionUnavailable ? "Unavailable" : attributionSummary.totalAttributedBookings}
                description="Bookings linked to tracked campaigns."
                icon={Target}
              />
              <SummaryCard
                title="Attributed Revenue"
                value={attributionUnavailable ? "Unavailable" : formatAmount(attributionSummary.totalAttributedRevenue)}
                description="Revenue from those bookings."
                icon={TrendingUp}
              />
              <SummaryCard
                title="CTA Clicks"
                value={attributionUnavailable ? "Unavailable" : attributionSummary.totalTrackedClicks}
                description="Clicks from content and campaign entry points."
                icon={TicketPercent}
              />
            </section>

            <Card className="min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm">
              <CardHeader className="min-w-0 space-y-3 px-4 py-5 sm:px-6">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="text-xl sm:text-2xl">Promo Studio</CardTitle>
                    <CardDescription className="max-w-full break-words leading-6">
                      Build offers, set the rules, and keep the queue tidy.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="rounded-full border-stone-200 bg-stone-50 text-stone-700">
                      {promoStudioUnavailable ? "Promo data unavailable" : `${promoSummary.total} promos`}
                    </Badge>
                    <Badge variant="outline" className="rounded-full border-stone-200 bg-stone-50 text-stone-700">
                      {promoStudioUnavailable ? "Retry to refresh" : `${promoSummary.scheduled} scheduled`}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="min-w-0 space-y-4 px-4 pb-4 sm:px-6 sm:pb-6">
                {promoStudioUnavailable ? (
                  <div className="rounded-3xl border border-dashed border-amber-200 bg-amber-50 px-4 py-8 text-center sm:px-6">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-200 bg-white text-amber-700">
                      <Package2 className="h-5 w-5" />
                    </div>
                    <h3 className="mt-4 text-lg font-semibold text-amber-950">Promo data could not be loaded</h3>
                    <p className="mt-2 text-sm leading-6 text-amber-900/90">
                      You can still create a promo, but the list needs the promos API to retry.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.8fr)_repeat(3,minmax(0,1fr))]">
                      <div className="relative sm:col-span-2 xl:col-span-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={searchTerm}
                          onChange={(event) => setSearchTerm(event.target.value)}
                          placeholder="Search promos, codes, audiences, or landing paths"
                          className="pl-9 text-base sm:text-sm"
                        />
                      </div>

                      <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as PromoStatusFilter)}>
                        <SelectTrigger className="text-base sm:text-sm">
                          <SelectValue placeholder="Filter by status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All statuses</SelectItem>
                          {marketingPromoStatuses.map((status) => (
                            <SelectItem key={status} value={status}>
                              {status.charAt(0).toUpperCase() + status.slice(1)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as PromoTypeFilter)}>
                        <SelectTrigger className="text-base sm:text-sm">
                          <SelectValue placeholder="Filter by type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All types</SelectItem>
                          {marketingPromoTypes.map((type) => (
                            <SelectItem key={type} value={type}>
                              {promoTypeLabels[type]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select value={channelFilter} onValueChange={(value) => setChannelFilter(value as PromoChannelFilter)}>
                        <SelectTrigger className="text-base sm:text-sm">
                          <SelectValue placeholder="Filter by channel" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All channels</SelectItem>
                          {marketingPromoChannels.map((channel) => (
                            <SelectItem key={channel} value={channel}>
                              {promoChannelLabels[channel]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {filteredPromos.length === 0 ? (
                      <div className="rounded-3xl border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center sm:px-6">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-stone-200 bg-white text-stone-600">
                          <Package2 className="h-5 w-5" />
                        </div>
                        <h3 className="mt-4 text-lg font-semibold text-foreground">No promos match these filters</h3>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          Try a broader search or create a new offer.
                        </p>
                      </div>
                    ) : (
                      <Accordion type="multiple" className="min-w-0 space-y-3">
                        {filteredPromos.map((promo) => {
                          const usageProgress = getUsageProgress(promo);
                          const categories = promo.eligibleCategories.length > 0
                            ? promo.eligibleCategories.map((category) => providerCategoryLabels[category as ProviderCategory]).join(", ")
                            : "All marketplace categories";

                          return (
                            <AccordionItem
                              key={promo.id}
                              value={promo.id}
                              className="overflow-hidden rounded-3xl border border-stone-200 bg-stone-50/70 px-0"
                            >
                              <AccordionTrigger className="px-4 py-4 text-left hover:no-underline sm:px-5">
                                <div className="flex min-w-0 flex-1 flex-col gap-4">
                                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="min-w-0 space-y-2">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-base font-semibold text-foreground sm:text-lg">{promo.name}</h3>
                                        {promo.code ? (
                                          <Badge variant="outline" className="rounded-full border-stone-200 bg-white text-stone-700">
                                            {promo.code}
                                          </Badge>
                                        ) : null}
                                      </div>
                                      <p className="text-sm leading-5 text-muted-foreground">
                                        {promo.description || "No campaign summary yet."}
                                      </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      <Badge className={cn("rounded-full border", getPromoStatusTone(promo.status))}>
                                        {promo.status}
                                      </Badge>
                                      <Badge className={cn("rounded-full border", getPromoTypeTone(promo.promoType))}>
                                        {promoTypeLabels[promo.promoType as MarketingPromoType] ?? promo.promoType}
                                      </Badge>
                                      <Badge variant="outline" className="rounded-full border-stone-200 bg-white text-stone-700">
                                        {promoCostAbsorptionLabels[getPromoCostAbsorptionValue(promo.costAbsorption)]}
                                      </Badge>
                                      <Badge variant="outline" className="rounded-full border-stone-200 bg-white text-stone-700">
                                        {promoChannelLabels[promo.channel as MarketingPromoChannel] ?? promo.channel}
                                      </Badge>
                                    </div>
                                  </div>

                                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                    <div className="rounded-2xl border border-stone-200 bg-white p-3">
                                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Offer</div>
                                      <div className="mt-2 text-sm font-semibold text-foreground">
                                        {formatPromoOffer(promo, formatAmount)}
                                      </div>
                                    </div>
                                    <div className="rounded-2xl border border-stone-200 bg-white p-3">
                                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Window</div>
                                      <div className="mt-2 text-sm font-semibold text-foreground">
                                        {formatPromoWindow(promo)}
                                      </div>
                                    </div>
                                    <div className="rounded-2xl border border-stone-200 bg-white p-3">
                                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Redemptions</div>
                                      <div className="mt-2 text-sm font-semibold text-foreground">
                                        {promo.redemptionCount}
                                        {promo.usageLimit ? ` / ${promo.usageLimit}` : ""}
                                      </div>
                                    </div>
                                    <div className="rounded-2xl border border-stone-200 bg-white p-3">
                                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Revenue</div>
                                      <div className="mt-2 text-sm font-semibold text-foreground">
                                        {formatAmount(promo.attributedRevenue)}
                                      </div>
                                    </div>
                                  </div>

                                  {usageProgress !== null ? (
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-muted-foreground">
                                        <span>Usage Pace</span>
                                        <span>{Math.round(usageProgress)}%</span>
                                      </div>
                                      <Progress value={usageProgress} className="h-2 bg-stone-200" />
                                    </div>
                                  ) : null}
                                </div>
                              </AccordionTrigger>

                              <AccordionContent className="border-t border-stone-200 bg-white px-4 py-4 sm:px-5">
                                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
                                  <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Audience</div>
                                      <div className="mt-3 space-y-2 text-sm text-stone-700">
                                        <p><span className="font-medium text-foreground">Audience:</span> {promo.audience || "General marketplace audience"}</p>
                                        <p><span className="font-medium text-foreground">Focus:</span> {categories}</p>
                                        <p><span className="font-medium text-foreground">Landing:</span> {promo.landingPath || "No landing path set"}</p>
                                      </div>
                                    </div>

                                    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Rules</div>
                                      <div className="mt-3 space-y-2 text-sm text-stone-700">
                                        <p><span className="font-medium text-foreground">Channel:</span> {promoChannelLabels[promo.channel as MarketingPromoChannel] ?? promo.channel}</p>
                                        <p><span className="font-medium text-foreground">Promo cost:</span> {promoCostAbsorptionLabels[getPromoCostAbsorptionValue(promo.costAbsorption)]}</p>
                                        <p><span className="font-medium text-foreground">Auto apply:</span> {promo.autoApply ? "Yes" : "Code required"}</p>
                                        <p><span className="font-medium text-foreground">Required mix:</span> {promo.requiredCategories.length > 0 ? promo.requiredCategories.map((category) => providerCategoryLabels[category as ProviderCategory]).join(", ") : "No bundle mix required"}</p>
                                        <p><span className="font-medium text-foreground">Minimum spend:</span> {promo.minimumSpend ? formatAmount(promo.minimumSpend) : "Not set"}</p>
                                        <p><span className="font-medium text-foreground">Minimum nights:</span> {promo.minimumNights ?? "Not set"}</p>
                                        <p><span className="font-medium text-foreground">Minimum guests:</span> {promo.minimumGuests ?? "Not set"}</p>
                                        <p><span className="font-medium text-foreground">Bundled services:</span> {promo.minimumServiceCount ?? "Not set"}</p>
                                        <p><span className="font-medium text-foreground">Updated:</span> {formatDateLabel(promo.updatedAt.slice(0, 10))}</p>
                                      </div>
                                    </div>

                                    {promo.notes ? (
                                      <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:col-span-2">
                                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Notes</div>
                                        <p className="mt-3 text-sm leading-6 text-stone-700">
                                          {promo.notes}
                                        </p>
                                      </div>
                                    ) : null}
                                  </div>

                                  <div className="space-y-3 rounded-2xl border border-stone-200 bg-stone-50 p-4">
                                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Actions</div>

                                    <Button
                                      variant="outline"
                                      className="w-full justify-start"
                                      onClick={() => setEditingPromo(promo)}
                                    >
                                      <Edit className="h-4 w-4" />
                                      Edit Promo
                                    </Button>

                                    {promo.code ? (
                                      <Button
                                        variant="outline"
                                        className="w-full justify-start"
                                        onClick={async () => {
                                          await navigator.clipboard.writeText(promo.code!);
                                          toast({ title: "Code copied", description: `${promo.code} is ready to paste.` });
                                        }}
                                      >
                                        <Copy className="h-4 w-4" />
                                        Copy Code
                                      </Button>
                                    ) : null}

                                    <Button
                                      variant="destructive"
                                      className="w-full justify-start"
                                      onClick={() => setPromoToDelete(promo)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                      Delete Promo
                                    </Button>
                                  </div>
                                </div>
                              </AccordionContent>
                            </AccordionItem>
                          );
                        })}
                      </Accordion>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <Card className="min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm">
                <CardHeader className="min-w-0 space-y-1 px-4 py-5 sm:px-6">
                  <CardTitle className="text-xl sm:text-2xl">Revenue Pace</CardTitle>
                  <CardDescription className="max-w-full break-words leading-6">
                    Recent booking revenue from the web app.
                  </CardDescription>
                </CardHeader>
                <CardContent className="min-w-0 space-y-4 px-4 pb-4 sm:px-6 sm:pb-6">
                  {revenueUnavailable ? (
                    <div className="rounded-3xl border border-dashed border-amber-200 bg-amber-50 px-4 py-10 text-center text-sm text-amber-900/90">
                      Revenue trend data could not be loaded right now.
                    </div>
                  ) : revenueChartData.length > 0 ? (
                    <ChartContainer
                      className="h-[260px] w-full"
                      config={{
                        revenue: {
                          label: "Revenue",
                          color: "#0f766e",
                        },
                      }}
                    >
                      <BarChart data={revenueChartData} margin={{ left: 8, right: 8, top: 12 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} tickMargin={8} />
                        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                        <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[14, 14, 0, 0]} />
                      </BarChart>
                    </ChartContainer>
                  ) : (
                    <div className="rounded-3xl border border-dashed border-stone-200 bg-stone-50 px-4 py-10 text-center text-sm text-muted-foreground">
                      Revenue data will appear here once bookings are available.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm">
                <CardHeader className="min-w-0 space-y-1 px-4 py-5 sm:px-6">
                  <CardTitle className="text-xl sm:text-2xl">Top Demand</CardTitle>
                  <CardDescription className="max-w-full break-words leading-6">
                    Services already drawing bookings.
                  </CardDescription>
                </CardHeader>
                <CardContent className="min-w-0 space-y-3 px-4 pb-4 sm:px-6 sm:pb-6">
                  {popularServicesUnavailable ? (
                    <div className="rounded-3xl border border-dashed border-amber-200 bg-amber-50 px-4 py-10 text-center text-sm text-amber-900/90">
                      Popular service data could not be loaded right now.
                    </div>
                  ) : popularServices.length > 0 ? popularServices.slice(0, 5).map((service, index) => (
                    <div
                      key={`${service.serviceId}-${service.serviceName}`}
                      className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Top {index + 1}
                        </div>
                        <div className="mt-1 truncate text-sm font-semibold text-foreground">
                          {service.serviceName}
                        </div>
                      </div>
                      <Badge variant="outline" className="rounded-full border-stone-200 bg-white text-stone-700">
                        {service.bookingCount} bookings
                      </Badge>
                    </div>
                  )) : (
                    <div className="rounded-3xl border border-dashed border-stone-200 bg-stone-50 px-4 py-10 text-center text-sm text-muted-foreground">
                      Popular service data will appear here once bookings accumulate.
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Card className="min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm">
                <CardHeader className="min-w-0 space-y-1 px-4 py-5 sm:px-6">
                  <CardTitle className="text-xl sm:text-2xl">Content Performance</CardTitle>
                  <CardDescription className="max-w-full break-words leading-6">
                    Watch what is live and what is actually pushing guests toward booking.
                  </CardDescription>
                </CardHeader>
                <CardContent className="min-w-0 space-y-4 px-4 pb-4 sm:px-6 sm:pb-6">
                  {blogUnavailable ? (
                    <div className="rounded-3xl border border-dashed border-amber-200 bg-amber-50 px-4 py-10 text-center text-sm text-amber-900/90">
                      Blog publishing insights could not be loaded right now.
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        <SummaryCard
                          title="Published"
                          value={blogSummary.published}
                          description="Articles live on site."
                          icon={Sparkles}
                        />
                        <SummaryCard
                          title="Drafts"
                          value={blogSummary.drafts}
                          description="Posts still waiting to ship."
                          icon={Edit}
                        />
                        <SummaryCard
                          title="SEO Ready"
                          value={blogSummary.seoReady}
                          description="Posts with core SEO fields filled."
                          icon={Target}
                        />
                        <SummaryCard
                          title="CTA Ready"
                          value={blogSummary.withConversionCta}
                          description="Posts with a booking path."
                          icon={TicketPercent}
                        />
                        <SummaryCard
                          title="Stale"
                          value={blogSummary.stale}
                          description="Posts that likely need a refresh."
                          icon={TimerReset}
                        />
                      </div>

                      <div className="space-y-3">
                        {blogSummary.recent.length > 0 ? blogSummary.recent.map((post) => (
                          <div
                            key={post.id}
                            className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-foreground">{post.title}</div>
                              <div className="mt-1 text-sm text-muted-foreground">
                                Updated {formatDateLabel((post.updatedAt || post.createdAt).slice(0, 10))}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge className={cn("rounded-full border", post.status === "published" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900")}>
                                {post.status}
                              </Badge>
                              {isSeoReady(post) ? (
                                <Badge variant="outline" className="rounded-full border-stone-200 bg-white text-stone-700">
                                  SEO ready
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                        )) : (
                          <div className="rounded-3xl border border-dashed border-stone-200 bg-stone-50 px-4 py-10 text-center text-sm text-muted-foreground">
                            No blog posts yet. Create content in the blog section to support promos and search visibility.
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  <div className="space-y-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Top Content
                    </div>
                    {attributionUnavailable ? (
                      <div className="rounded-3xl border border-dashed border-amber-200 bg-amber-50 px-4 py-10 text-center text-sm text-amber-900/90">
                        Attribution content metrics could not be loaded right now.
                      </div>
                    ) : attributionSummary.topContent.length > 0 ? attributionSummary.topContent.slice(0, 4).map((item, index) => (
                      <div
                        key={`${item.sourceId ?? item.sourcePath ?? item.sourceSlug ?? index}`}
                        className="rounded-2xl border border-stone-200 bg-stone-50 p-4"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                              Content #{index + 1}
                            </div>
                            <div className="mt-1 truncate text-sm font-semibold text-foreground">
                              {item.sourceTitle || item.sourceSlug || item.sourcePath || "Untitled entry point"}
                            </div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {item.sourcePath || "No source path captured"}
                            </div>
                          </div>
                          <div className="grid w-full grid-cols-2 gap-2 text-sm sm:w-auto sm:min-w-[16rem] sm:text-right">
                            <div>
                              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Views</div>
                              <div className="mt-1 font-semibold text-foreground">{item.viewCount}</div>
                            </div>
                            <div>
                              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Clicks</div>
                              <div className="mt-1 font-semibold text-foreground">{item.clickCount}</div>
                            </div>
                            <div>
                              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Bookings</div>
                              <div className="mt-1 font-semibold text-foreground">{item.bookingCount}</div>
                            </div>
                            <div>
                              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Revenue</div>
                              <div className="mt-1 font-semibold text-foreground">{formatAmount(item.revenue)}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-3xl border border-dashed border-stone-200 bg-stone-50 px-4 py-10 text-center text-sm text-muted-foreground">
                        Publish CTA-enabled content to start seeing views, clicks, bookings, and revenue here.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm">
                <CardHeader className="min-w-0 space-y-1 px-4 py-5 sm:px-6">
                  <CardTitle className="text-xl sm:text-2xl">Attribution Funnel</CardTitle>
                  <CardDescription className="max-w-full break-words leading-6">
                    Track the path from views to booked revenue.
                  </CardDescription>
                </CardHeader>
                <CardContent className="min-w-0 space-y-4 px-4 pb-4 sm:px-6 sm:pb-6">
                  {attributionUnavailable ? (
                    <div className="rounded-3xl border border-dashed border-amber-200 bg-amber-50 px-4 py-10 text-center text-sm text-amber-900/90">
                      Attribution funnel data could not be loaded right now.
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            <Globe className="h-4 w-4" />
                            Tracked Views
                          </div>
                          <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                            {attributionSummary.totalTrackedViews}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            People who landed on tracked content or campaign entry points.
                          </p>
                        </div>

                        <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            <CalendarClock className="h-4 w-4" />
                            CTA Clicks
                          </div>
                          <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                            {attributionSummary.totalTrackedClicks}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            Guests who clicked through from content or a tracked promo surface.
                          </p>
                        </div>

                        <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            <Sparkles className="h-4 w-4" />
                            Attributed Bookings
                          </div>
                          <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                            {attributionSummary.totalAttributedBookings}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            Bookings that carried attribution into checkout.
                          </p>
                        </div>

                        <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            <Target className="h-4 w-4" />
                            Discount Given
                          </div>
                          <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                            {formatAmount(attributionSummary.totalAttributedDiscount)}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            Total discount used across attributed bookings.
                          </p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Top Promos
                        </div>
                        {attributionSummary.topPromos.length > 0 ? attributionSummary.topPromos.slice(0, 4).map((promo, index) => (
                          <div
                            key={`${promo.promoId ?? promo.promoCode ?? promo.promoName}-${index}`}
                            className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                                Promo #{index + 1}
                              </div>
                              <div className="mt-1 truncate text-sm font-semibold text-foreground">
                                {promo.promoName}
                              </div>
                              <div className="mt-1 text-sm text-muted-foreground">
                                {promo.promoCode ? `Code ${promo.promoCode}` : "Auto-applied bundle"}
                              </div>
                            </div>
                            <div className="grid w-full grid-cols-1 gap-2 text-sm sm:w-auto sm:min-w-[16rem] sm:grid-cols-3 sm:text-right">
                              <div>
                                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Bookings</div>
                                <div className="mt-1 font-semibold text-foreground">{promo.bookingCount}</div>
                              </div>
                              <div>
                                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Revenue</div>
                                <div className="mt-1 font-semibold text-foreground">{formatAmount(promo.revenue)}</div>
                              </div>
                              <div>
                                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Discount</div>
                                <div className="mt-1 font-semibold text-foreground">{formatAmount(promo.discountAmount)}</div>
                              </div>
                            </div>
                          </div>
                        )) : (
                          <div className="rounded-3xl border border-dashed border-stone-200 bg-stone-50 px-4 py-10 text-center text-sm text-muted-foreground">
                            Promo performance will appear here once tracked bookings start converting.
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Button asChild variant="outline" className="w-full justify-start">
                      <Link href="/admin/dashboard">Open Main Dashboard</Link>
                    </Button>
                    <Button asChild variant="outline" className="w-full justify-start">
                      <Link href="/admin/bookings">Review Booking Queue</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </section>
          </>
        ) : null}
      </div>

      <Dialog open={Boolean(editingPromo)} onOpenChange={(open) => !open && setEditingPromo(null)}>
        <DialogContent className="max-h-[95vh] w-[calc(100vw-1rem)] max-w-5xl overflow-y-auto sm:w-full">
          <DialogHeader>
            <DialogTitle>Edit Promo</DialogTitle>
          </DialogHeader>
          {editingPromo ? <PromoForm promo={editingPromo} onSuccess={() => setEditingPromo(null)} /> : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(promoToDelete)} onOpenChange={(open) => !open && setPromoToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this promo?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the campaign from the marketing section. Tracking values saved here will also be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (!promoToDelete) {
                  return;
                }
                deleteMutation.mutate(promoToDelete.id);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Promo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
