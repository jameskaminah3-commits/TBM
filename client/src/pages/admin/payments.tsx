import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  payoutMethods,
  payoutStatuses,
  providerCategories,
  type AdminBookingPayout,
  type AdminCommissionSettingSummary,
  type PaymentManagementData,
  type PayoutMethod,
  type PayoutStatus,
  type ProviderCategory,
} from "@shared/schema";
import { AdminLayout } from "@/components/admin-layout";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/lib/currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  Building2,
  CheckCircle2,
  Clock3,
  DollarSign,
  HandCoins,
  RefreshCw,
  Wallet,
  type LucideIcon,
} from "lucide-react";

type ProviderFilter = "all" | "unpaid" | "paid";
type PaymentMethodValue = PayoutMethod | "none";

type PayoutDraft = {
  status: PayoutStatus;
  paymentMethod: PaymentMethodValue;
  paymentReference: string;
  notes: string;
};

type ProviderGroup = {
  providerUserId: string;
  providerName: string;
  providerEmail: string;
  settings: AdminCommissionSettingSummary[];
  payouts: AdminBookingPayout[];
  unpaidPayouts: AdminBookingPayout[];
  paidPayouts: AdminBookingPayout[];
  cancelledPayouts: AdminBookingPayout[];
  categories: ProviderCategory[];
  assignedListings: number;
  missingCommissionCount: number;
  totalGross: number;
  totalCommission: number;
  totalUnpaid: number;
  totalPaid: number;
};

const providerCategoryOrder = providerCategories.reduce<Record<string, number>>((map, category, index) => {
  map[category] = index;
  return map;
}, {});

function formatLabel(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string | null) {
  if (!value) {
    return "No date";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "No date";
  }

  return parsed.toLocaleDateString("en-KE", {
    month: "short",
    day: "numeric",
    year: parsed.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function getBookingReference(bookingId: string) {
  return bookingId.slice(0, 8).toUpperCase();
}

function getPaymentMethodLabel(method: PaymentMethodValue) {
  return method === "none" ? "Not set" : formatLabel(method);
}

function getPromoLabel(payout: AdminBookingPayout) {
  return payout.marketingAttribution?.promoName
    || payout.marketingAttribution?.promoCode
    || "Promo";
}

function getStatusTone(status: PayoutStatus) {
  switch (status) {
    case "approved":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "paid":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "cancelled":
      return "border-stone-200 bg-stone-100 text-stone-700";
    case "pending":
    default:
      return "border-amber-200 bg-amber-50 text-amber-900";
  }
}

function getCategoryTone(category: ProviderCategory) {
  switch (category) {
    case "stays":
      return "border-stone-200 bg-stone-100 text-stone-700";
    case "cars":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "cooks":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "errands":
      return "border-teal-200 bg-teal-50 text-teal-800";
    case "experiences":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    default:
      return "border-stone-200 bg-stone-100 text-stone-700";
  }
}

function sumAmounts(
  payouts: AdminBookingPayout[],
  field: "grossAmount" | "commissionAmount" | "payoutAmount",
) {
  return payouts.reduce((sum, payout) => sum + payout[field], 0);
}

function buildProviderGroups(data?: PaymentManagementData): ProviderGroup[] {
  if (!data) {
    return [];
  }

  const groups = new Map<string, {
    providerUserId: string;
    providerName: string;
    providerEmail: string;
    settings: AdminCommissionSettingSummary[];
    payouts: AdminBookingPayout[];
  }>();

  const ensureGroup = (providerUserId: string, providerName: string, providerEmail: string) => {
    let group = groups.get(providerUserId);
    if (!group) {
      group = {
        providerUserId,
        providerName,
        providerEmail,
        settings: [],
        payouts: [],
      };
      groups.set(providerUserId, group);
    }
    return group;
  };

  data.commissionSettings.forEach((setting) => {
    ensureGroup(setting.providerUserId, setting.providerName, setting.providerEmail).settings.push(setting);
  });

  data.payouts.forEach((payout) => {
    ensureGroup(payout.providerUserId, payout.providerName, payout.providerEmail).payouts.push(payout);
  });

  return Array.from(groups.values())
    .map((group) => {
      const payouts = [...group.payouts];
      const unpaidPayouts = payouts.filter((payout) => payout.status === "pending" || payout.status === "approved");
      const paidPayouts = payouts.filter((payout) => payout.status === "paid");
      const cancelledPayouts = payouts.filter((payout) => payout.status === "cancelled");
      const categories = Array.from(
        new Set([
          ...group.settings.map((setting) => setting.providerCategory),
          ...payouts.map((payout) => payout.providerCategory),
        ]),
      ).sort((left, right) => providerCategoryOrder[left] - providerCategoryOrder[right]);

      return {
        providerUserId: group.providerUserId,
        providerName: group.providerName,
        providerEmail: group.providerEmail,
        settings: group.settings.sort(
          (left, right) => providerCategoryOrder[left.providerCategory] - providerCategoryOrder[right.providerCategory],
        ),
        payouts,
        unpaidPayouts,
        paidPayouts,
        cancelledPayouts,
        categories,
        assignedListings: group.settings.reduce((sum, setting) => sum + setting.assignedListings, 0),
        missingCommissionCount: group.settings.filter((setting) => !setting.isConfigured && setting.assignedListings > 0).length,
        totalGross: sumAmounts(payouts, "grossAmount"),
        totalCommission: sumAmounts(payouts, "commissionAmount"),
        totalUnpaid: sumAmounts(unpaidPayouts, "payoutAmount"),
        totalPaid: sumAmounts(paidPayouts, "payoutAmount"),
      };
    })
    .sort((left, right) =>
      right.unpaidPayouts.length - left.unpaidPayouts.length
      || right.totalUnpaid - left.totalUnpaid
      || left.providerName.localeCompare(right.providerName),
    );
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="border-stone-200/80 bg-white/92 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {title}
            </p>
            <p className="text-2xl font-semibold tracking-tight text-foreground">{value}</p>
            <p className="text-sm leading-6 text-muted-foreground">{detail}</p>
          </div>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-stone-200 bg-stone-50 text-stone-700">
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PaymentsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Card key={index} className="border-stone-200/80 bg-white/92">
            <CardContent className="space-y-3 p-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-4 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-stone-200/80 bg-white/92">
        <CardContent className="space-y-4 p-5">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-[1.5rem]" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminPayments() {
  const { formatAmount } = useCurrency();
  const { toast } = useToast();
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("unpaid");
  const [commissionDrafts, setCommissionDrafts] = useState<Record<string, string>>({});
  const [payoutDrafts, setPayoutDrafts] = useState<Record<string, Partial<PayoutDraft>>>({});

  const { data, isLoading, error } = useQuery<PaymentManagementData>({
    queryKey: ["/api/admin/payments"],
  });

  const providerGroups = useMemo(() => buildProviderGroups(data), [data]);
  const filteredProviderGroups = useMemo(
    () => providerGroups.filter((group) => {
      if (providerFilter === "paid") {
        return group.paidPayouts.length > 0;
      }

      if (providerFilter === "unpaid") {
        return group.unpaidPayouts.length > 0;
      }

      return group.payouts.length > 0 || group.settings.length > 0;
    }),
    [providerFilter, providerGroups],
  );

  const syncMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/payments/sync");
      return response.json() as Promise<{ created: number; updated: number; cancelled: number }>;
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/payments"] });
      toast({
        title: "Payments synced",
        description: `${result.created} added, ${result.updated} refreshed, ${result.cancelled} cancelled.`,
      });
    },
    onError: (mutationError) => {
      toast({
        title: "Sync failed",
        description: mutationError instanceof Error ? mutationError.message : "Could not sync payouts.",
        variant: "destructive",
      });
    },
  });

  const commissionMutation = useMutation({
    mutationFn: async (payload: {
      providerUserId: string;
      providerCategory: ProviderCategory;
      commissionPercent: number;
    }) => {
      const response = await apiRequest("PATCH", "/api/admin/payments/commission-settings", payload);
      return response.json();
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/payments"] });
      setCommissionDrafts((current) => {
        const next = { ...current };
        delete next[`${variables.providerUserId}:${variables.providerCategory}`];
        return next;
      });
      toast({
        title: "Commission updated",
        description: "The provider payout rate is now up to date.",
      });
    },
    onError: (mutationError) => {
      toast({
        title: "Commission not saved",
        description: mutationError instanceof Error ? mutationError.message : "Could not save this commission rate.",
        variant: "destructive",
      });
    },
  });

  const payoutMutation = useMutation({
    mutationFn: async (payload: { id: string } & PayoutDraft) => {
      const response = await apiRequest("PATCH", `/api/admin/payouts/${payload.id}`, {
        status: payload.status,
        paymentMethod: payload.paymentMethod === "none" ? "" : payload.paymentMethod,
        paymentReference: payload.paymentReference,
        notes: payload.notes,
      });
      return response.json();
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/payments"] });
      setPayoutDrafts((current) => {
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
      toast({
        title: "Order updated",
        description: "The payout status has been saved.",
      });
    },
    onError: (mutationError) => {
      toast({
        title: "Update failed",
        description: mutationError instanceof Error ? mutationError.message : "Could not save payout changes.",
        variant: "destructive",
      });
    },
  });

  const handleCommissionChange = (key: string, value: string) => {
    setCommissionDrafts((current) => ({ ...current, [key]: value }));
  };

  const handlePayoutDraftChange = (id: string, patch: Partial<PayoutDraft>) => {
    setPayoutDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  };

  const getCommissionValue = (setting: AdminCommissionSettingSummary) => {
    const key = `${setting.providerUserId}:${setting.providerCategory}`;
    return commissionDrafts[key] ?? String(setting.commissionPercent);
  };

  const getPayoutDraft = (payout: AdminBookingPayout): PayoutDraft => ({
    status: payoutDrafts[payout.id]?.status ?? payout.status,
    paymentMethod: payoutDrafts[payout.id]?.paymentMethod ?? payout.paymentMethod ?? "none",
    paymentReference: payoutDrafts[payout.id]?.paymentReference ?? payout.paymentReference ?? "",
    notes: payoutDrafts[payout.id]?.notes ?? payout.notes ?? "",
  });

  const saveCommission = (setting: AdminCommissionSettingSummary) => {
    const commissionPercent = Number(getCommissionValue(setting));
    if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
      toast({
        title: "Enter a valid commission",
        description: "Commission must stay between 0 and 100.",
        variant: "destructive",
      });
      return;
    }

    commissionMutation.mutate({
      providerUserId: setting.providerUserId,
      providerCategory: setting.providerCategory,
      commissionPercent,
    });
  };

  const savePayout = (payout: AdminBookingPayout) => {
    payoutMutation.mutate({
      id: payout.id,
      ...getPayoutDraft(payout),
    });
  };

  const renderPromoAttribution = (payout: AdminBookingPayout) => {
    if (!payout.marketingAttribution) {
      return null;
    }

    return (
      <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border border-emerald-200 bg-white text-emerald-800">Promo applied</Badge>
          <span className="text-sm font-semibold text-emerald-950">{getPromoLabel(payout)}</span>
          {payout.marketingAttribution.promoCode ? (
            <span className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-700">
              {payout.marketingAttribution.promoCode}
            </span>
          ) : null}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-[0.68rem] uppercase tracking-[0.18em] text-emerald-700">Original booking</div>
            <div className="mt-1 text-sm font-semibold text-emerald-950">{formatAmount(payout.marketingAttribution.originalSubtotal)}</div>
          </div>
          <div>
            <div className="text-[0.68rem] uppercase tracking-[0.18em] text-emerald-700">Customer saved</div>
            <div className="mt-1 text-sm font-semibold text-emerald-950">{formatAmount(payout.marketingAttribution.discountAmount)}</div>
          </div>
          <div>
            <div className="text-[0.68rem] uppercase tracking-[0.18em] text-emerald-700">Net booking</div>
            <div className="mt-1 text-sm font-semibold text-emerald-950">{formatAmount(payout.marketingAttribution.finalRevenue)}</div>
          </div>
        </div>
        <div className="mt-2 text-xs text-emerald-800/80">
          Provider payout already uses the discounted booking total.
        </div>
      </div>
    );
  };

  return (
    <AdminLayout>
      <div className="min-h-full bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(244,244,245,0.9))]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
          <section className="overflow-hidden rounded-[2rem] border border-stone-200/80 bg-white/92 shadow-[0_24px_80px_-58px_rgba(15,23,42,0.5)]">
            <div className="flex flex-col gap-5 px-5 py-6 sm:px-7 sm:py-7 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl space-y-3">
                <Badge variant="outline" className="w-fit border-stone-200 bg-stone-50 px-3 py-1 text-[0.68rem] uppercase tracking-[0.22em] text-stone-600">
                  Payments
                </Badge>
                <div className="space-y-2">
                  <h1 className="text-3xl font-semibold tracking-tight text-stone-950">Provider payouts</h1>
                  <p className="max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
                    Review unpaid bookings, release approved payouts, and keep commission settings tidy without digging through long forms.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline" className="border-stone-200 bg-white text-stone-700">
                    {filteredProviderGroups.length} providers in view
                  </Badge>
                  {data ? (
                    <Badge variant="outline" className="border-stone-200 bg-white text-stone-700">
                      {data.unpaidPayoutCount} unpaid orders
                    </Badge>
                  ) : null}
                  {data?.partnersNeedingCommissionSetup ? (
                    <Badge className="border border-amber-200 bg-amber-50 text-amber-900">
                      {data.partnersNeedingCommissionSetup} commission setups pending
                    </Badge>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                {(["unpaid", "paid", "all"] as ProviderFilter[]).map((filter) => (
                  <Button
                    key={filter}
                    type="button"
                    size="sm"
                    variant={providerFilter === filter ? "default" : "outline"}
                    className={cn("rounded-full px-4", providerFilter !== filter && "bg-white")}
                    onClick={() => setProviderFilter(filter)}
                  >
                    {filter === "all" ? "All providers" : filter === "unpaid" ? "Unpaid first" : "Paid only"}
                  </Button>
                ))}
                <Button type="button" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
                  <RefreshCw className={cn("h-4 w-4", syncMutation.isPending && "animate-spin")} />
                  Sync bookings
                </Button>
              </div>
            </div>
          </section>

          {isLoading ? <PaymentsSkeleton /> : null}

          {!isLoading && error ? (
            <Card className="border-rose-200 bg-rose-50/80">
              <CardContent className="p-5">
                <p className="text-sm font-medium text-rose-900">Could not load payments.</p>
                <p className="mt-1 text-sm text-rose-700">
                  {error instanceof Error ? error.message : "Try syncing again or refresh the page."}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {!isLoading && data ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <MetricCard
                  title="Gross tracked"
                  value={formatAmount(data.totalGrossTracked)}
                  detail={`${data.payouts.length} linked orders`}
                  icon={DollarSign}
                />
                <MetricCard
                  title="Commission kept"
                  value={formatAmount(data.totalCommissionTracked)}
                  detail="Platform share on tracked bookings"
                  icon={HandCoins}
                />
                <MetricCard
                  title="Unpaid payouts"
                  value={formatAmount(data.totalPendingPayouts + data.totalApprovedPayouts)}
                  detail={`${data.unpaidPayoutCount} pending or approved`}
                  icon={Clock3}
                />
                <MetricCard
                  title="Ready to release"
                  value={formatAmount(data.totalApprovedPayouts)}
                  detail="Already approved for payment"
                  icon={Wallet}
                />
                <MetricCard
                  title="Paid out"
                  value={formatAmount(data.totalPaidOut)}
                  detail={`${data.paidPayoutCount} completed payouts`}
                  icon={CheckCircle2}
                />
              </div>

              <Card className="border-stone-200/80 bg-white/92 shadow-[0_20px_70px_-52px_rgba(15,23,42,0.45)]">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col gap-2 border-b border-stone-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
                    <div className="space-y-1">
                      <h2 className="text-xl font-semibold tracking-tight text-stone-950">By provider</h2>
                      <p className="text-sm text-muted-foreground">
                        Open a provider to adjust commission, review unpaid bookings, and confirm paid orders.
                      </p>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Unpaid and paid orders stay separated so the queue is easier to manage.
                    </div>
                  </div>

                  {filteredProviderGroups.length === 0 ? (
                    <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-stone-200 bg-stone-50 text-stone-600">
                        <Building2 className="h-6 w-6" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-base font-medium text-stone-900">Nothing to review here yet.</p>
                        <p className="text-sm text-muted-foreground">
                          Switch the filter or sync bookings to pull the latest payout rows.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <Accordion
                      type="multiple"
                      defaultValue={filteredProviderGroups[0] ? [filteredProviderGroups[0].providerUserId] : []}
                      className="space-y-4 pt-4"
                    >
                      {filteredProviderGroups.map((group) => (
                        <AccordionItem
                          key={group.providerUserId}
                          value={group.providerUserId}
                          className="overflow-hidden rounded-[1.6rem] border border-stone-200 bg-white px-0"
                        >
                          <AccordionTrigger className="gap-4 px-4 py-4 text-left hover:no-underline sm:px-6 sm:py-5">
                            <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                              <div className="space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="text-lg font-semibold text-stone-950">{group.providerName}</h3>
                                  {group.categories.map((category) => (
                                    <Badge
                                      key={category}
                                      variant="outline"
                                      className={cn("border text-[0.68rem] uppercase tracking-[0.2em]", getCategoryTone(category))}
                                    >
                                      {formatLabel(category)}
                                    </Badge>
                                  ))}
                                  {group.missingCommissionCount > 0 ? (
                                    <Badge className="border border-amber-200 bg-amber-50 text-amber-900">
                                      Setup needed
                                    </Badge>
                                  ) : (
                                    <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-800">
                                      Commission set
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                  <span>{group.providerEmail || "No email listed"}</span>
                                  <span>{group.assignedListings} assigned listings</span>
                                  <span>{group.payouts.length} tracked orders</span>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2">
                                  <div className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">Unpaid</div>
                                  <div className="mt-1 text-base font-semibold text-stone-950">{formatAmount(group.totalUnpaid)}</div>
                                </div>
                                <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2">
                                  <div className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">Paid</div>
                                  <div className="mt-1 text-base font-semibold text-stone-950">{formatAmount(group.totalPaid)}</div>
                                </div>
                                <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2">
                                  <div className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">Gross</div>
                                  <div className="mt-1 text-base font-semibold text-stone-950">{formatAmount(group.totalGross)}</div>
                                </div>
                                <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2">
                                  <div className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">Commission</div>
                                  <div className="mt-1 text-base font-semibold text-stone-950">{formatAmount(group.totalCommission)}</div>
                                </div>
                              </div>
                            </div>
                          </AccordionTrigger>

                          <AccordionContent className="px-4 pb-5 sm:px-6">
                            <div className="space-y-4">
                              <section className="rounded-[1.5rem] border border-stone-200 bg-stone-50/70 p-4">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                                  <div>
                                    <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-700">Commission</h4>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                      Keep provider rates short and simple. One rate per service line.
                                    </p>
                                  </div>
                                </div>

                                <div className="mt-4 grid gap-3">
                                  {group.settings.length === 0 ? (
                                    <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-3 text-sm text-muted-foreground">
                                      No commission categories are linked to this provider yet.
                                    </div>
                                  ) : (
                                    group.settings.map((setting) => {
                                      const draftValue = getCommissionValue(setting);
                                      const key = `${setting.providerUserId}:${setting.providerCategory}`;

                                      return (
                                        <div
                                          key={key}
                                          className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                                        >
                                          <div className="space-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                              <p className="font-medium text-stone-950">{formatLabel(setting.providerCategory)}</p>
                                              <Badge variant="outline" className={cn("border", getCategoryTone(setting.providerCategory))}>
                                                {setting.assignedListings} listings
                                              </Badge>
                                            </div>
                                            <p className="text-sm text-muted-foreground">
                                              {setting.isConfigured ? "Current rate is active." : "Set a rate for future payouts."}
                                            </p>
                                          </div>

                                          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                                            <div className="flex items-center gap-2">
                                              <Input
                                                type="number"
                                                min={0}
                                                max={100}
                                                step={1}
                                                value={draftValue}
                                                onChange={(event) => handleCommissionChange(key, event.target.value)}
                                                className="w-full sm:w-24"
                                              />
                                              <span className="text-sm text-muted-foreground">%</span>
                                            </div>
                                            <Button
                                              type="button"
                                              size="sm"
                                              onClick={() => saveCommission(setting)}
                                              disabled={commissionMutation.isPending}
                                            >
                                              Save
                                            </Button>
                                          </div>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              </section>

                              {providerFilter !== "paid" ? (
                                <section className="rounded-[1.5rem] border border-amber-200 bg-amber-50/50 p-4">
                                  <div className="flex flex-col gap-1 pb-3">
                                    <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-950">Unpaid orders</h4>
                                    <p className="text-sm text-amber-900/80">
                                      Pending and approved payouts stay here until payment is completed.
                                    </p>
                                  </div>

                                  {group.unpaidPayouts.length === 0 ? (
                                    <div className="rounded-2xl border border-dashed border-amber-200 bg-white px-4 py-3 text-sm text-muted-foreground">
                                      No unpaid orders in this view.
                                    </div>
                                  ) : (
                                    <Accordion type="multiple" className="space-y-3">
                                      {group.unpaidPayouts.map((payout) => {
                                        const draft = getPayoutDraft(payout);

                                        return (
                                          <AccordionItem
                                            key={payout.id}
                                            value={payout.id}
                                            className="overflow-hidden rounded-2xl border border-amber-200 bg-white px-0"
                                          >
                                            <AccordionTrigger className="gap-4 px-4 py-4 text-left hover:no-underline">
                                              <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                                <div className="space-y-1">
                                                  <div className="flex flex-wrap items-center gap-2">
                                                    <p className="text-base font-semibold text-stone-950">{payout.serviceName}</p>
                                                    <Badge className={cn("border text-xs", getStatusTone(payout.status))}>
                                                      {formatLabel(payout.status)}
                                                    </Badge>
                                                  </div>
                                                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                                    <span>#{getBookingReference(payout.bookingId)}</span>
                                                    <span>{payout.guestName}</span>
                                                    <span>{payout.dueAt ? `Due ${formatDate(payout.dueAt)}` : "Due date pending"}</span>
                                                    {payout.marketingAttribution ? (
                                                      <span className="font-medium text-emerald-700">
                                                        {getPromoLabel(payout)}
                                                      </span>
                                                    ) : null}
                                                  </div>
                                                </div>

                                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                                  <div>
                                                    <div className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">Gross</div>
                                                    <div className="mt-1 text-sm font-semibold text-stone-950">{formatAmount(payout.grossAmount)}</div>
                                                  </div>
                                                  <div>
                                                    <div className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">Commission</div>
                                                    <div className="mt-1 text-sm font-semibold text-stone-950">{formatAmount(payout.commissionAmount)}</div>
                                                  </div>
                                                  <div>
                                                    <div className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">Provider gets</div>
                                                    <div className="mt-1 text-sm font-semibold text-stone-950">{formatAmount(payout.payoutAmount)}</div>
                                                  </div>
                                                  <div>
                                                    <div className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">Method</div>
                                                    <div className="mt-1 text-sm font-semibold text-stone-950">{getPaymentMethodLabel(draft.paymentMethod)}</div>
                                                  </div>
                                                </div>
                                              </div>
                                            </AccordionTrigger>

                                            <AccordionContent className="px-4 pb-4">
                                              <div className="grid gap-3 lg:grid-cols-4">
                                                <div className="space-y-2">
                                                  <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                                    Status
                                                  </label>
                                                  <Select
                                                    value={draft.status}
                                                    onValueChange={(value) => handlePayoutDraftChange(payout.id, { status: value as PayoutStatus })}
                                                  >
                                                    <SelectTrigger>
                                                      <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                      {payoutStatuses.map((status) => (
                                                        <SelectItem key={status} value={status}>
                                                          {formatLabel(status)}
                                                        </SelectItem>
                                                      ))}
                                                    </SelectContent>
                                                  </Select>
                                                </div>

                                                <div className="space-y-2">
                                                  <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                                    Method
                                                  </label>
                                                  <Select
                                                    value={draft.paymentMethod}
                                                    onValueChange={(value) => handlePayoutDraftChange(payout.id, { paymentMethod: value as PaymentMethodValue })}
                                                  >
                                                    <SelectTrigger>
                                                      <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                      <SelectItem value="none">Not set</SelectItem>
                                                      {payoutMethods.map((method) => (
                                                        <SelectItem key={method} value={method}>
                                                          {formatLabel(method)}
                                                        </SelectItem>
                                                      ))}
                                                    </SelectContent>
                                                  </Select>
                                                </div>

                                                <div className="space-y-2">
                                                  <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                                    Reference
                                                  </label>
                                                  <Input
                                                    value={draft.paymentReference}
                                                    onChange={(event) => handlePayoutDraftChange(payout.id, { paymentReference: event.target.value })}
                                                    placeholder="Optional"
                                                  />
                                                </div>

                                                <div className="space-y-2">
                                                  <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                                    Internal note
                                                  </label>
                                                  <Input
                                                    value={draft.notes}
                                                    onChange={(event) => handlePayoutDraftChange(payout.id, { notes: event.target.value })}
                                                    placeholder="Short note"
                                                  />
                                                </div>
                                              </div>

                                              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                                                <div className="text-sm text-muted-foreground">
                                                  Last updated {formatDate(payout.updatedAt)}
                                                </div>
                                                <Button
                                                  type="button"
                                                  size="sm"
                                                  onClick={() => savePayout(payout)}
                                                  disabled={payoutMutation.isPending}
                                                >
                                                  Save order
                                                </Button>
                                              </div>
                                              {renderPromoAttribution(payout)}
                                            </AccordionContent>
                                          </AccordionItem>
                                        );
                                      })}
                                    </Accordion>
                                  )}
                                </section>
                              ) : null}

                              {providerFilter !== "unpaid" ? (
                                <section className="rounded-[1.5rem] border border-sky-200 bg-sky-50/50 p-4">
                                  <div className="flex flex-col gap-1 pb-3">
                                    <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-950">Paid orders</h4>
                                    <p className="text-sm text-sky-900/80">
                                      Closed payouts stay grouped here with payment details attached.
                                    </p>
                                  </div>

                                  {group.paidPayouts.length === 0 ? (
                                    <div className="rounded-2xl border border-dashed border-sky-200 bg-white px-4 py-3 text-sm text-muted-foreground">
                                      No paid orders in this view.
                                    </div>
                                  ) : (
                                    <Accordion type="multiple" className="space-y-3">
                                      {group.paidPayouts.map((payout) => (
                                        <AccordionItem
                                          key={payout.id}
                                          value={payout.id}
                                          className="overflow-hidden rounded-2xl border border-sky-200 bg-white px-0"
                                        >
                                          <AccordionTrigger className="gap-4 px-4 py-4 text-left hover:no-underline">
                                            <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                              <div className="space-y-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                  <p className="text-base font-semibold text-stone-950">{payout.serviceName}</p>
                                                  <Badge className={cn("border text-xs", getStatusTone(payout.status))}>
                                                    {formatLabel(payout.status)}
                                                  </Badge>
                                                </div>
                                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                                  <span>#{getBookingReference(payout.bookingId)}</span>
                                                  <span>{payout.guestName}</span>
                                                  <span>{payout.paidAt ? `Paid ${formatDate(payout.paidAt)}` : "Paid date pending"}</span>
                                                  {payout.marketingAttribution ? (
                                                    <span className="font-medium text-emerald-700">
                                                      {getPromoLabel(payout)}
                                                    </span>
                                                  ) : null}
                                                </div>
                                              </div>

                                              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                                <div>
                                                  <div className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">Provider gets</div>
                                                  <div className="mt-1 text-sm font-semibold text-stone-950">{formatAmount(payout.payoutAmount)}</div>
                                                </div>
                                                <div>
                                                  <div className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">Method</div>
                                                  <div className="mt-1 text-sm font-semibold text-stone-950">
                                                    {getPaymentMethodLabel(payout.paymentMethod ?? "none")}
                                                  </div>
                                                </div>
                                                <div>
                                                  <div className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">Reference</div>
                                                  <div className="mt-1 text-sm font-semibold text-stone-950">
                                                    {payout.paymentReference || "Not set"}
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                          </AccordionTrigger>

                                            <AccordionContent className="px-4 pb-4">
                                              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                              <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                                                <div className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">Gross</div>
                                                <div className="mt-1 font-semibold text-stone-950">{formatAmount(payout.grossAmount)}</div>
                                              </div>
                                              <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                                                <div className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">Commission</div>
                                                <div className="mt-1 font-semibold text-stone-950">{formatAmount(payout.commissionAmount)}</div>
                                              </div>
                                              <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                                                <div className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">Guest</div>
                                                <div className="mt-1 font-semibold text-stone-950">{payout.guestName}</div>
                                              </div>
                                                <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                                                  <div className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">Note</div>
                                                  <div className="mt-1 font-semibold text-stone-950">{payout.notes || "No note"}</div>
                                                </div>
                                              </div>
                                              {renderPromoAttribution(payout)}
                                            </AccordionContent>
                                          </AccordionItem>
                                        ))}
                                    </Accordion>
                                  )}
                                </section>
                              ) : null}

                              {providerFilter === "all" && group.cancelledPayouts.length > 0 ? (
                                <section className="rounded-[1.5rem] border border-stone-200 bg-stone-50/60 p-4">
                                  <div>
                                    <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-700">Cancelled orders</h4>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                      {group.cancelledPayouts.length} cancelled payout rows remain here for reference.
                                    </p>
                                  </div>
                                </section>
                              ) : null}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  )}
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </AdminLayout>
  );
}
